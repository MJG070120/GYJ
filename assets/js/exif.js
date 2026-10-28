/**
 * 极简 EXIF 读取器：只取摄影相关的几个字段。
 * 输入 JPEG 文件前段的 ArrayBuffer，返回可读的字符串对象。
 */

const TAGS = {
  MAKE: 0x010f,
  MODEL: 0x0110,
  EXIF_IFD: 0x8769,
  DATE_ORIGINAL: 0x9003,
  EXPOSURE_TIME: 0x829a,
  FNUMBER: 0x829d,
  ISO: 0x8827,
  FOCAL_LENGTH: 0x920a,
  LENS_MODEL: 0xa434,
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export function readExif(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12) return {};

    if (view.getUint16(0) !== 0xffd8) return {};

    let offset = 2;
    let tiffStart = -1;

    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = view.getUint8(offset + 1);

      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;

      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > view.byteLength) break;

      if (marker === 0xe1 && length >= 8 && offset + 10 <= view.byteLength) {
        const isExif =
          view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0x0000;
        if (isExif) {
          tiffStart = offset + 10;
          break;
        }
      }

      offset += 2 + length;
    }

    if (tiffStart < 0) return {};
    return parseTiff(view, tiffStart);
  } catch {
    return {};
  }
}

function parseTiff(view, start) {
  if (start + 8 > view.byteLength) return {};

  const little = view.getUint16(start) === 0x4949;
  if (view.getUint16(start + 2, little) !== 0x002a) return {};

  const ifd0 = start + view.getUint32(start + 4, little);
  const raw = {};
  let exifIfd = -1;

  if (ifd0 + 2 <= view.byteLength) {
    exifIfd = readIfd(view, start, ifd0, little, raw);
  }
  if (exifIfd > 0 && exifIfd + 2 <= view.byteLength) {
    readIfd(view, start, exifIfd, little, raw);
  }

  return {
    camera: formatCamera(raw[TAGS.MAKE], raw[TAGS.MODEL]),
    lens: cleanString(raw[TAGS.LENS_MODEL]),
    aperture: formatAperture(raw[TAGS.FNUMBER]),
    shutter: formatShutter(raw[TAGS.EXPOSURE_TIME]),
    iso: formatIso(raw[TAGS.ISO]),
    focal: formatFocal(raw[TAGS.FOCAL_LENGTH]),
    takenAt: formatDate(raw[TAGS.DATE_ORIGINAL]),
  };
}

function readIfd(view, tiffStart, offset, little, raw) {
  const count = view.getUint16(offset, little);
  const limit = Math.min(count, 80);
  let exifPointer = -1;

  for (let i = 0; i < limit; i += 1) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const amount = view.getUint32(entry + 4, little);
    const unit = TYPE_SIZE[type];
    if (!unit) continue;

    const size = unit * amount;
    if (size <= 0) continue;

    const dataOffset = size <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
    if (dataOffset + size > view.byteLength) continue;

    if (tag === TAGS.EXIF_IFD && type === 4) {
      exifPointer = tiffStart + view.getUint32(entry + 8, little);
      continue;
    }

    if (tag === TAGS.MAKE || tag === TAGS.MODEL || tag === TAGS.LENS_MODEL || tag === TAGS.DATE_ORIGINAL) {
      raw[tag] = readAscii(view, dataOffset, size);
    } else if (tag === TAGS.EXPOSURE_TIME && (type === 5 || type === 10)) {
      raw[tag] = readRational(view, dataOffset, little, type === 10);
    } else if (tag === TAGS.FNUMBER && (type === 5 || type === 10)) {
      raw[tag] = readRational(view, dataOffset, little, type === 10);
    } else if (tag === TAGS.ISO && (type === 3 || type === 4)) {
      raw[tag] = type === 3 ? view.getUint16(dataOffset, little) : view.getUint32(dataOffset, little);
    } else if (tag === TAGS.FOCAL_LENGTH && (type === 5 || type === 10)) {
      raw[tag] = readRational(view, dataOffset, little, type === 10);
    }
  }

  return exifPointer;
}

function readAscii(view, offset, size) {
  let value = '';
  const end = Math.min(offset + size, view.byteLength);
  for (let i = offset; i < end; i += 1) {
    const code = view.getUint8(i);
    if (code === 0) break;
    value += String.fromCharCode(code);
  }
  return value;
}

function readRational(view, offset, little, signed) {
  if (offset + 8 > view.byteLength) return null;
  const numerator = signed ? view.getInt32(offset, little) : view.getUint32(offset, little);
  const denominator = signed ? view.getInt32(offset + 4, little) : view.getUint32(offset + 4, little);
  if (!denominator) return null;
  return numerator / denominator;
}

function cleanString(value) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '';
}

function formatCamera(make, model) {
  const brand = cleanString(make)
    .replace(/\b(CORPORATION|CORP|INC|LTD|CO|IMAGING)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const name = cleanString(model);
  if (!brand && !name) return '';
  if (!brand) return name;
  if (!name) return brand;

  // "NIKON CORPORATION" + "NIKON D850" 只保留一次品牌名
  const firstWord = brand.split(' ')[0].toLowerCase();
  if (name.toLowerCase().startsWith(firstWord)) return name;
  return `${brand} ${name}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 10) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function formatAperture(value) {
  return Number.isFinite(value) && value > 0 ? `f/${formatNumber(value)}` : '';
}

function formatShutter(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1) return `${formatNumber(value)} s`;
  return `1/${Math.max(1, Math.round(1 / value))} s`;
}

function formatIso(value) {
  return Number.isFinite(value) && value > 0 ? `ISO ${Math.round(value)}` : '';
}

function formatFocal(value) {
  return Number.isFinite(value) && value > 0 ? `${formatNumber(value)}mm` : '';
}

function formatDate(value) {
  const text = cleanString(value);
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(text);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
