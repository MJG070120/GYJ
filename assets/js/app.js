/**
 * 光影集 · LUMIÈRE — GitHub Pages + Supabase
 *
 * 访客只读；注册用户可上传，只能编辑/删除自己的作品；
 * 管理员（profiles.is_admin）可管理全部作品。
 */

import { readExif } from './exif.js';

/* ------------------------------------------------------------------ config */

const cfg = window.GYJ_CONFIG || {};
const BUCKET = cfg.bucket || 'photos';
const SDK = window.supabase;

const supabaseReady = Boolean(SDK && cfg.supabaseUrl && cfg.supabaseKey);
const client = supabaseReady
  ? SDK.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/* -------------------------------------------------------------------- dom */

const $ = (selector, root = document) => root.querySelector(selector);

const els = {
  header: $('#siteHeader'),
  search: $('#searchInput'),
  searchClear: $('#searchClear'),
  uploadBtn: $('#uploadBtn'),
  loginBtn: $('#loginBtn'),
  userMenu: $('#userMenu'),
  userChip: $('#userChip'),
  userAvatar: $('#userAvatar'),
  userName: $('#userName'),
  userDropdown: $('#userDropdown'),
  menuName: $('#menuName'),
  menuEmail: $('#menuEmail'),
  menuAdmin: $('#menuAdmin'),
  logoutBtn: $('#logoutBtn'),
  favoriteFilter: $('#favoriteFilter'),
  sortSelect: $('#sortSelect'),
  tagChips: $('#tagChips'),
  collectionTitle: $('#collectionTitle'),
  collectionCount: $('#collectionCount'),
  gallery: $('#gallery'),
  initialLoader: $('#initialLoader'),
  emptyState: $('#emptyState'),
  emptyTitle: $('#emptyTitle'),
  emptyCopy: $('#emptyCopy'),
  emptyAction: $('#emptyAction'),
  noResults: $('#noResults'),
  clearFilters: $('#clearFilters'),
  statCount: $('#statCount'),
  statAuthors: $('#statAuthors'),
  statFavorites: $('#statFavorites'),
  dragOverlay: $('#dragOverlay'),
  fileInput: $('#fileInput'),
  uploadModal: $('#uploadModal'),
  uploadClose: $('#uploadClose'),
  dropzone: $('#dropzone'),
  uploadQueue: $('#uploadQueue'),
  uploadNote: $('#uploadNote'),
  progressWrap: $('#progressWrap'),
  progressBar: $('#progressBar'),
  authModal: $('#authModal'),
  authClose: $('#authClose'),
  authForm: $('#authForm'),
  authTitle: $('#authTitle'),
  authTabs: document.querySelectorAll('.auth-tab'),
  nameField: $('#nameField'),
  authName: $('#authName'),
  authEmail: $('#authEmail'),
  authPassword: $('#authPassword'),
  authError: $('#authError'),
  authNote: $('#authNote'),
  authSubmit: $('#authSubmit'),
  lightbox: $('#lightbox'),
  lbStage: $('.lb-stage'),
  lbImageWrap: $('#lbImageWrap'),
  lbImage: $('#lbImage'),
  lbSpinner: $('#lbSpinner'),
  lbCounter: $('#lbCounter'),
  lbClose: $('#lbClose'),
  lbPrev: $('#lbPrev'),
  lbNext: $('#lbNext'),
  lbPanel: $('#lbPanel'),
  lbFilmBadge: $('#lbFilmBadge'),
  lbOwner: $('#lbOwner'),
  lbExif: $('#lbExif'),
  lbDate: $('#lbDate'),
  lbFavorite: $('#lbFavorite'),
  lbDownload: $('#lbDownload'),
  lbDelete: $('#lbDelete'),
  lbHint: $('#lbHint'),
  editTitle: $('#editTitle'),
  editCaption: $('#editCaption'),
  editFilm: $('#editFilm'),
  editLocation: $('#editLocation'),
  editTags: $('#editTags'),
  saveState: $('#saveState'),
  toast: $('#toast'),
  toastText: $('#toastText'),
  toastAction: $('#toastAction'),
  bootError: $('#bootError'),
};

/* ------------------------------------------------------------------ state */

const state = {
  photos: [],
  filtered: [],
  cards: new Map(),
  query: '',
  tag: null,
  favoriteOnly: false,
  sort: 'newest',
  loading: true,
  loadError: false,
  currentId: null,
  lastWidth: 0,
  user: null,
  profile: null,
  isAdmin: false,
  canEditCurrent: false,
  authMode: 'login',
  authReady: false,
  favorites: new Set(),
  edit: null,
  upload: { busy: false, total: 0, done: 0, success: 0, failed: 0, urls: [] },
};

const FAVORITES_KEY = 'gyj:favorites';
const HEART_SVG =
  '<svg class="icon heart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2 4.6 13a4.8 4.8 0 0 1 6.8-6.8L12 6.8l.6-.6A4.8 4.8 0 0 1 19.4 13Z"></path></svg>';

let saveStateTimer = null;
let toastTimer = null;
let deleteTimer = null;
let lastFocused = null;
let uploadLastFocused = null;
let authLastFocused = null;
let imageToken = 0;
let authEventRegistered = false;

/* ---------------------------------------------------------------- helpers */

const pad = (value) => String(value).padStart(2, '0');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function titleOf(photo) {
  return (photo.title || '').trim() || '未命名作品';
}

function metaOf(photo) {
  const parts = [photo.owner_name, photo.film].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  if (photo.location) return photo.location;
  if (photo.tags && photo.tags.length) return photo.tags.map((tag) => `#${tag}`).join('  ');
  return '摄影作品';
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseTags(value) {
  const seen = new Set();
  const tags = [];
  for (const raw of String(value).split(/[,，、]/)) {
    const tag = raw.replace(/^#+/, '').trim().slice(0, 18);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function photoById(id) {
  return state.photos.find((photo) => photo.id === id) || null;
}

function canEditPhoto(photo) {
  return Boolean(
    state.user &&
      photo &&
      (photo.owner_id === state.user.id || state.isAdmin),
  );
}

function displayName() {
  return (
    (state.profile && state.profile.display_name && state.profile.display_name.trim()) ||
    (state.user && state.user.email ? state.user.email.split('@')[0] : '') ||
    '用户'
  );
}

function avatarInitial() {
  const chars = Array.from(displayName().trim());
  return chars.length ? chars[0].toUpperCase() : 'U';
}

function redirectUrl() {
  try {
    return new URL('.', window.location.href).href;
  } catch {
    return window.location.href;
  }
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorText(error, fallback = '操作失败') {
  const message = (error && error.message) || '';
  if (/PGRST205|Could not find the table/i.test(message)) {
    return '数据库还没有初始化，请先运行 supabase/schema.sql。';
  }
  if (/Bucket not found/i.test(message)) {
    return '图片存储桶还没有创建，请先运行 supabase/schema.sql。';
  }
  if (/row-level security|permission denied/i.test(message)) {
    return '没有权限执行这个操作。';
  }
  if (/duplicate key/i.test(message)) {
    return '这张照片已经存在了。';
  }
  if (/Invalid login credentials/i.test(message)) {
    return '邮箱或密码不正确。';
  }
  if (/Email not confirmed/i.test(message)) {
    return '邮箱还没有验证，请先查收验证邮件。';
  }
  if (/User already registered/i.test(message)) {
    return '这个邮箱已经注册过了，请直接登录。';
  }
  if (/Password should be at least/i.test(message)) {
    return '密码至少需要 6 位。';
  }
  if (/For security purposes|rate limit/i.test(message)) {
    return '操作太频繁，请稍等一会儿再试。';
  }
  if (/Invalid email/i.test(message)) {
    return '邮箱格式不正确。';
  }
  if (/Database error saving new user/i.test(message)) {
    return '数据库还没有初始化，请先运行 supabase/schema.sql。';
  }
  if (/JWT expired|invalid JWT/i.test(message)) {
    return '登录状态已过期，请重新登录。';
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return '网络连接失败，请检查网络后重试。';
  }
  return message || fallback;
}

function sanitizeFileName(name) {
  return (name || 'photo')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60) || 'photo';
}

/* ---------------------------------------------------------------- favorites */

function loadFavorites() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ toast */

function showToast(message, options = {}) {
  const { actionLabel = '', onAction = null, duration = 3400 } = options;
  els.toastText.textContent = message;
  els.toastAction.hidden = !actionLabel;
  if (actionLabel) {
    els.toastAction.textContent = actionLabel;
    els.toastAction.onclick = () => {
      hideToast();
      if (onAction) onAction();
    };
  }
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  els.toast.classList.remove('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 260);
}

/* --------------------------------------------------------------- supabase */

function storageUrl(path) {
  if (!client || !path) return '';
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function normalizePhoto(row) {
  return {
    ...row,
    id: row.id,
    owner_id: row.owner_id,
    owner_name: row.owner_name || '',
    title: row.title || '',
    caption: row.caption || '',
    film: row.film || '',
    location: row.location || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    exif: row.exif && typeof row.exif === 'object' ? row.exif : {},
    createdAt: row.created_at || row.createdAt || '',
    full_path: row.full_path || '',
    thumb_path: row.thumb_path || '',
    src: storageUrl(row.full_path),
    thumb: storageUrl(row.thumb_path),
    favorite: state.favorites.has(row.id),
  };
}

async function loadPhotos() {
  if (!client) throw new Error('Supabase 客户端没有初始化');
  const { data, error } = await client
    .from('photos')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  state.photos = (data || []).map(normalizePhoto);
}

async function fetchProfile(user) {
  const fallback = {
    display_name: (user.email || '用户').split('@')[0],
    is_admin: false,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await client
      .from('profiles')
      .select('display_name,is_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (data) return data;
    if (error) console.warn('[光影集] 读取资料失败：', error.message);
    await sleep(250);
  }
  return fallback;
}

async function restoreSession() {
  if (!client) return;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    await applySession(data.session || null);
  } catch (error) {
    console.warn('[光影集] 读取登录状态失败：', error.message);
    state.authReady = true;
  }
}

async function applySession(session) {
  state.user = (session && session.user) || null;
  state.profile = null;
  state.isAdmin = false;

  if (state.user) {
    state.profile = await fetchProfile(state.user);
    state.isAdmin = state.profile.is_admin === true;
  }

  state.authReady = true;
  renderAuthUi();

  if (!els.lightbox.hidden && state.currentId) {
    const photo = photoById(state.currentId);
    if (photo) {
      const index = state.filtered.findIndex((item) => item.id === photo.id);
      populateLightbox(photo, index < 0 ? 0 : index);
    }
  }
}

function watchAuth() {
  if (!client || authEventRegistered) return;
  authEventRegistered = true;
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      state.edit = null;
      applySession(null);
      closeUserMenu();
      if (!els.lightbox.hidden) closeLightbox();
      if (!els.uploadModal.hidden) closeUpload();
      showToast('已退出登录');
      return;
    }

    if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      applySession(session || null).then(() => {
        if (event === 'SIGNED_IN') closeAuth();
      });
    }
  });
}

/* ------------------------------------------------------------- header / auth ui */

function renderAuthUi() {
  const loggedIn = Boolean(state.user);
  els.loginBtn.hidden = loggedIn;
  els.uploadBtn.hidden = !loggedIn;
  els.userMenu.hidden = !loggedIn;

  if (loggedIn) {
    const name = displayName();
    els.userName.textContent = name;
    els.userAvatar.textContent = avatarInitial();
    els.menuName.textContent = name;
    els.menuEmail.textContent = state.user.email || '';
    els.menuAdmin.hidden = !state.isAdmin;
  } else {
    closeUserMenu();
  }

  if (!state.loadError) {
    if (loggedIn) {
      els.emptyTitle.textContent = '画廊还是空的';
      els.emptyCopy.textContent = '上传第一张照片，让光留在这里。';
      els.emptyAction.textContent = '上传作品';
      els.emptyAction.dataset.action = 'upload';
    } else {
      els.emptyTitle.textContent = '画廊还是空的';
      els.emptyCopy.textContent = '登录后上传第一张照片，让光留在这里。';
      els.emptyAction.textContent = '登录 / 注册';
      els.emptyAction.dataset.action = 'auth';
    }
    els.emptyAction.hidden = false;
  }
}

function bindHeader() {
  const onScroll = () => {
    els.header.classList.toggle('is-scrolled', window.scrollY > 10);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  els.search.addEventListener('input', () => {
    els.searchClear.hidden = !els.search.value;
    onSearchInput();
  });

  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.search.value = '';
      els.searchClear.hidden = true;
      state.query = '';
      render();
      els.search.blur();
    }
  });

  els.searchClear.addEventListener('click', () => {
    els.search.value = '';
    els.searchClear.hidden = true;
    state.query = '';
    render();
    els.search.focus();
  });

  els.uploadBtn.addEventListener('click', openUpload);
  els.loginBtn.addEventListener('click', () => openAuth('login'));
  els.emptyAction.addEventListener('click', () => {
    if (els.emptyAction.dataset.action === 'upload') openUpload();
    else openAuth('login');
  });

  els.userChip.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleUserMenu(els.userDropdown.hidden);
  });

  els.logoutBtn.addEventListener('click', async () => {
    closeUserMenu();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) showToast(errorText(error, '退出失败'));
  });

  document.addEventListener('click', (event) => {
    if (!els.userMenu.hidden && !els.userMenu.contains(event.target)) closeUserMenu();
  });
}

function toggleUserMenu(open) {
  els.userDropdown.hidden = !open;
  els.userChip.setAttribute('aria-expanded', String(open));
}

function closeUserMenu() {
  els.userDropdown.hidden = true;
  els.userChip.setAttribute('aria-expanded', 'false');
}

function observeLayout() {
  const setHeaderHeight = () => {
    document.documentElement.style.setProperty('--header-h', `${els.header.offsetHeight}px`);
  };
  setHeaderHeight();

  if ('ResizeObserver' in window) {
    new ResizeObserver(setHeaderHeight).observe(els.header);

    new ResizeObserver(() => {
      const width = els.gallery.clientWidth;
      if (width === state.lastWidth) return;
      state.lastWidth = width;
      layoutMasonry();
    }).observe(els.gallery);
  }

  window.addEventListener('resize', () => {
    const width = els.gallery.clientWidth;
    if (width !== state.lastWidth) {
      state.lastWidth = width;
      layoutMasonry();
    }
  });
}

/* ------------------------------------------------------------------ toolbar */

function bindToolbar() {
  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    render();
  });

  els.favoriteFilter.addEventListener('click', () => {
    state.favoriteOnly = !state.favoriteOnly;
    els.favoriteFilter.setAttribute('aria-pressed', String(state.favoriteOnly));
    render();
  });

  els.tagChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const tag = chip.dataset.tag || null;
    state.tag = state.tag === tag ? null : tag;
    render();
  });

  els.clearFilters.addEventListener('click', clearFilters);
}

const onSearchInput = debounce(() => {
  state.query = els.search.value.trim();
  render();
}, 140);

function clearFilters() {
  state.query = '';
  state.tag = null;
  state.favoriteOnly = false;
  els.search.value = '';
  els.searchClear.hidden = true;
  els.favoriteFilter.setAttribute('aria-pressed', 'false');
  render();
}

/* ------------------------------------------------------------------ gallery */

function rebuildGallery() {
  els.gallery.innerHTML = '';
  state.cards.clear();
  els.gallery.classList.add('no-anim');

  for (const photo of state.photos) {
    const card = createCard(photo);
    state.cards.set(photo.id, card);
    els.gallery.append(card);
  }

  render();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => els.gallery.classList.remove('no-anim'));
  });
}

function createCard(photo) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = photo.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${titleOf(photo)}，作者 ${photo.owner_name || '匿名'}，查看大图`);

  const image = document.createElement('img');
  image.className = 'card-img';
  image.src = photo.thumb;
  image.alt = titleOf(photo);
  image.loading = 'lazy';
  image.decoding = 'async';
  image.draggable = false;
  image.addEventListener('load', () => image.classList.add('loaded'));
  image.addEventListener('error', () => image.remove());

  const shade = document.createElement('div');
  shade.className = 'card-shade';

  const info = document.createElement('div');
  info.className = 'card-info';
  const heading = document.createElement('h3');
  heading.textContent = titleOf(photo);
  const meta = document.createElement('p');
  meta.textContent = metaOf(photo);
  info.append(heading, meta);

  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.className = 'card-fav';
  favorite.innerHTML = HEART_SVG;
  favorite.setAttribute('aria-label', photo.favorite ? '取消收藏' : '收藏');
  favorite.setAttribute('aria-pressed', String(photo.favorite));
  favorite.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(photo);
  });

  card.append(image, shade, info, favorite);

  card.addEventListener('click', (event) => {
    if (event.target.closest('.card-fav')) return;
    openLightbox(photo.id);
  });

  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLightbox(photo.id);
    }
  });

  requestAnimationFrame(() => card.classList.add('is-ready'));
  return card;
}

function updateCard(photo) {
  const card = state.cards.get(photo.id);
  if (!card) return;
  const heading = $('.card-info h3', card);
  const meta = $('.card-info p', card);
  const image = $('.card-img', card);
  const favorite = $('.card-fav', card);

  if (heading) heading.textContent = titleOf(photo);
  if (meta) meta.textContent = metaOf(photo);
  if (image) image.alt = titleOf(photo);
  if (favorite) {
    favorite.setAttribute('aria-pressed', String(photo.favorite));
    favorite.setAttribute('aria-label', photo.favorite ? '取消收藏' : '收藏');
  }
  card.setAttribute('aria-label', `${titleOf(photo)}，作者 ${photo.owner_name || '匿名'}，查看大图`);
}

function getFilteredPhotos() {
  const query = state.query.toLowerCase();
  let list = state.photos.filter((photo) => {
    if (state.tag && !photo.tags.includes(state.tag)) return false;
    if (state.favoriteOnly && !photo.favorite) return false;
    if (!query) return true;

    const haystack = [
      photo.title,
      photo.caption,
      photo.film,
      photo.location,
      photo.owner_name,
      ...photo.tags,
      photo.exif && photo.exif.camera,
      photo.exif && photo.exif.lens,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });

  list = list.slice().sort((a, b) => {
    if (state.sort === 'title') {
      return titleOf(a).localeCompare(titleOf(b), 'zh-Hans-CN');
    }
    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    return state.sort === 'oldest' ? timeA - timeB : timeB - timeA;
  });

  return list;
}

function render() {
  if (state.loading || state.loadError) return;

  state.filtered = getFilteredPhotos();
  const visible = new Set(state.filtered.map((photo) => photo.id));

  for (const [id, card] of state.cards) {
    card.hidden = !visible.has(id);
  }

  els.gallery.hidden = state.filtered.length === 0;
  layoutMasonry();
  updateCounters();
  updateChips();
  updateStats();

  const isEmpty = state.photos.length === 0;
  const noResults = !isEmpty && state.filtered.length === 0;

  els.emptyState.hidden = !isEmpty;
  els.noResults.hidden = !noResults;
  els.initialLoader.hidden = true;
}

function updateCounters() {
  els.collectionCount.textContent = String(state.filtered.length);
  const filtered = Boolean(state.query) || Boolean(state.tag) || state.favoriteOnly;
  els.collectionTitle.textContent = filtered ? '筛选结果' : '全部作品';
}

function updateStats() {
  els.statCount.textContent = String(state.photos.length);

  const authors = new Set(
    state.photos
      .map((photo) => (photo.owner_name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  els.statAuthors.textContent = String(authors.size);

  els.statFavorites.textContent = String(state.photos.filter((photo) => photo.favorite).length);
}

function updateChips() {
  const counts = new Map();
  for (const photo of state.photos) {
    for (const tag of photo.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  if (state.tag && !counts.has(state.tag)) state.tag = null;

  const tags = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], 'zh-Hans-CN');
  });

  const fragment = document.createDocumentFragment();

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'chip';
  all.dataset.tag = '';
  all.setAttribute('aria-pressed', String(!state.tag));
  all.innerHTML = `全部 <span class="chip-count">${state.photos.length}</span>`;
  fragment.append(all);

  for (const [tag, count] of tags) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.tag = tag;
    button.setAttribute('aria-pressed', String(state.tag === tag));
    button.innerHTML = `#${escapeHtml(tag)} <span class="chip-count">${count}</span>`;
    fragment.append(button);
  }

  els.tagChips.replaceChildren(fragment);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[character];
  });
}

/* ------------------------------------------------------------------ masonry */

function columnsForWidth(width) {
  if (width < 620) return 1;
  if (width < 1000) return 2;
  if (width < 1320) return 3;
  return 4;
}

function layoutMasonry() {
  const width = els.gallery.clientWidth;
  if (!width) return;

  const gap = width < 640 ? 12 : 18;
  const columns = columnsForWidth(width);
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const heights = new Array(columns).fill(0);

  for (const photo of state.filtered) {
    const card = state.cards.get(photo.id);
    if (!card) continue;

    const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1.5;
    const height = Math.round(columnWidth / ratio);

    let column = 0;
    for (let index = 1; index < columns; index += 1) {
      if (heights[index] < heights[column] - 0.5) column = index;
    }

    const x = column * (columnWidth + gap);
    const y = heights[column];

    card.style.width = `${columnWidth}px`;
    card.style.height = `${height}px`;
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    heights[column] = y + height + gap;
  }

  const total = Math.max(...heights) - gap;
  els.gallery.style.height = `${Math.max(0, total)}px`;
}

/* ------------------------------------------------------------------ lightbox */

function openLightbox(id) {
  const index = state.filtered.findIndex((photo) => photo.id === id);
  if (index === -1) return;

  flushEdit();
  state.currentId = id;

  const firstOpen = !els.lightbox.classList.contains('open');
  if (firstOpen) {
    lastFocused = document.activeElement;
    els.lightbox.hidden = false;
    document.body.classList.add('locked');
    requestAnimationFrame(() => els.lightbox.classList.add('open'));
    setTimeout(() => els.lbClose.focus({ preventScroll: true }), 60);
  }

  const photo = state.filtered[index];
  populateLightbox(photo, index);
  loadLightboxImage(photo);
  preloadNeighbors(index);
}

function closeLightbox() {
  if (els.lightbox.hidden) return;
  flushEdit();
  els.lightbox.classList.remove('open');
  document.body.classList.remove('locked');
  state.currentId = null;
  state.canEditCurrent = false;

  setTimeout(() => {
    els.lightbox.hidden = true;
    els.lbImage.removeAttribute('src');
    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus({ preventScroll: true });
    }
  }, 240);
}

function populateLightbox(photo, index) {
  const total = state.filtered.length;
  const safeIndex = Math.max(0, index);
  const canEdit = canEditPhoto(photo);
  state.canEditCurrent = canEdit;

  els.lbCounter.textContent = `${pad(safeIndex + 1)} / ${pad(total)}`;

  els.lbFilmBadge.hidden = !photo.film;
  els.lbFilmBadge.textContent = photo.film || '';

  els.lbOwner.replaceChildren();
  const owner = document.createElement('span');
  owner.textContent = `作者 · ${photo.owner_name || '匿名用户'}`;
  els.lbOwner.append(owner);

  els.editTitle.value = photo.title;
  els.editCaption.value = photo.caption;
  els.editFilm.value = photo.film;
  els.editLocation.value = photo.location;
  els.editTags.value = photo.tags.join(', ');

  els.editTitle.readOnly = !canEdit;
  els.editCaption.readOnly = !canEdit;
  els.editFilm.readOnly = !canEdit;
  els.editLocation.readOnly = !canEdit;
  els.editTags.readOnly = !canEdit;

  els.lbPanel.classList.toggle('is-readonly', !canEdit);
  els.lbDelete.hidden = !canEdit;
  els.lbHint.textContent = canEdit
    ? '← → 切换 · Esc 关闭 · 编辑会自动保存'
    : '← → 切换 · Esc 关闭';

  if (!canEdit) {
    els.editCaption.hidden = !photo.caption;
    for (const [input] of [
      [els.editFilm],
      [els.editLocation],
      [els.editTags],
    ]) {
      const field = input.closest('.field');
      if (field) field.hidden = !input.value.trim();
    }
  } else {
    els.editCaption.hidden = false;
    for (const input of [els.editFilm, els.editLocation, els.editTags]) {
      const field = input.closest('.field');
      if (field) field.hidden = false;
    }
  }

  autoSizeCaption();

  const takenAt = photo.exif && photo.exif.takenAt
    ? photo.exif.takenAt.replace(/^(\d{4})-(\d{2})-(\d{2})/, '$1.$2.$3')
    : '';

  els.lbDate.textContent = [
    takenAt ? `拍摄于 ${takenAt}` : '',
    `收录于 ${formatDate(photo.createdAt)}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  renderExif(photo);
  updateFavoriteUi(photo);

  resetDeleteButton();
  setSaveState('');

  els.lbPrev.hidden = total <= 1;
  els.lbNext.hidden = total <= 1;
}

function renderExif(photo) {
  const exif = photo.exif || {};
  const fields = [
    ['相机', exif.camera],
    ['镜头', exif.lens],
    ['光圈', exif.aperture],
    ['快门', exif.shutter],
    ['感光度', exif.iso],
    ['焦距', exif.focal],
  ].filter(([, value]) => Boolean(value));

  if (!fields.length) {
    els.lbExif.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [label, value] of fields) {
    const cell = document.createElement('div');
    cell.className = 'exif-cell';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    cell.append(dt, dd);
    fragment.append(cell);
  }
  els.lbExif.replaceChildren(fragment);
}

function loadLightboxImage(photo) {
  const token = (imageToken += 1);
  els.lbImage.classList.remove('ready');
  els.lbSpinner.hidden = false;

  const done = () => {
    if (token !== imageToken) return;
    els.lbSpinner.hidden = true;
    els.lbImage.classList.add('ready');
  };

  els.lbImage.onload = done;
  els.lbImage.onerror = () => {
    if (token !== imageToken) return;
    els.lbSpinner.hidden = true;
  };
  els.lbImage.alt = `${titleOf(photo)}，作者 ${photo.owner_name || '匿名'}，摄影作品`;
  els.lbImage.src = photo.src;

  if (els.lbImage.complete && els.lbImage.naturalWidth) done();
}

function preloadNeighbors(index) {
  for (const offset of [1, -1]) {
    const neighbor = state.filtered[(index + offset + state.filtered.length) % state.filtered.length];
    if (!neighbor || neighbor.id === state.currentId) continue;
    const image = new Image();
    image.src = neighbor.src;
  }
}

function navigateLightbox(direction) {
  if (!state.filtered.length) return;
  const index = state.filtered.findIndex((photo) => photo.id === state.currentId);
  if (index === -1) return;
  const next = (index + direction + state.filtered.length) % state.filtered.length;
  openLightbox(state.filtered[next].id);
}

function autoSizeCaption() {
  if (els.editCaption.hidden) return;
  els.editCaption.style.height = 'auto';
  els.editCaption.style.height = `${Math.min(180, els.editCaption.scrollHeight)}px`;
}

function setSaveState(text) {
  clearTimeout(saveStateTimer);
  els.saveState.textContent = text;
  els.saveState.classList.toggle('show', Boolean(text));
  if (text === '已保存') {
    saveStateTimer = setTimeout(() => {
      els.saveState.textContent = '';
      els.saveState.classList.remove('show');
    }, 1800);
  }
}

function resetDeleteButton() {
  clearTimeout(deleteTimer);
  els.lbDelete.classList.remove('lb-delete-confirm');
  els.lbDelete.textContent = '删除';
}

function bindLightbox() {
  els.lbClose.addEventListener('click', closeLightbox);
  els.lbPrev.addEventListener('click', () => navigateLightbox(-1));
  els.lbNext.addEventListener('click', () => navigateLightbox(1));

  els.lbStage.addEventListener('click', (event) => {
    if (event.target === els.lbStage || event.target === els.lbImageWrap) {
      closeLightbox();
    }
  });

  els.editTitle.addEventListener('input', () => queueEdit('title', els.editTitle.value));
  els.editCaption.addEventListener('input', () => {
    autoSizeCaption();
    queueEdit('caption', els.editCaption.value);
  });
  els.editFilm.addEventListener('input', () => queueEdit('film', els.editFilm.value));
  els.editLocation.addEventListener('input', () => queueEdit('location', els.editLocation.value));
  els.editTags.addEventListener('input', () => queueEdit('tags', parseTags(els.editTags.value)));

  for (const field of [els.editTitle, els.editFilm, els.editLocation]) {
    field.addEventListener('blur', () => {
      field.value = field.value.trim();
    });
  }

  els.editTags.addEventListener('blur', () => {
    const photo = photoById(state.currentId);
    els.editTags.value = photo ? photo.tags.join(', ') : parseTags(els.editTags.value).join(', ');
  });

  els.lbFavorite.addEventListener('click', () => {
    const photo = photoById(state.currentId);
    if (photo) toggleFavorite(photo);
  });

  els.lbDownload.addEventListener('click', async () => {
    const photo = photoById(state.currentId);
    if (!photo) return;
    try {
      const response = await fetch(photo.src);
      if (!response.ok) throw new Error('下载失败');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFileName(titleOf(photo))}.jpg`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      window.open(photo.src, '_blank', 'noopener');
      showToast('已在新标签页打开图片');
    }
  });

  els.lbDelete.addEventListener('click', async () => {
    const photo = photoById(state.currentId);
    if (!photo || !canEditPhoto(photo)) return;

    if (!els.lbDelete.classList.contains('lb-delete-confirm')) {
      els.lbDelete.classList.add('lb-delete-confirm');
      els.lbDelete.textContent = '再点一次确认';
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(resetDeleteButton, 4000);
      return;
    }

    resetDeleteButton();
    els.lbDelete.disabled = true;
    try {
      const { error } = await client.from('photos').delete().eq('id', photo.id);
      if (error) throw error;

      if (photo.full_path || photo.thumb_path) {
        const paths = [photo.full_path, photo.thumb_path].filter(Boolean);
        const { error: storageError } = await client.storage.from(BUCKET).remove(paths);
        if (storageError) console.warn('[光影集] 文件清理失败：', storageError.message);
      }

      removePhotoFromState(photo.id);
      closeLightbox();
      showToast(`已删除《${titleOf(photo)}》`);
    } catch (error) {
      showToast(errorText(error, '删除失败'));
    } finally {
      els.lbDelete.disabled = false;
    }
  });

  let touchX = 0;
  let touchY = 0;
  els.lbStage.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.changedTouches[0];
      touchX = touch.clientX;
      touchY = touch.clientY;
    },
    { passive: true },
  );

  els.lbStage.addEventListener(
    'touchend',
    (event) => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchX;
      const dy = touch.clientY - touchY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        navigateLightbox(dx > 0 ? -1 : 1);
      }
    },
    { passive: true },
  );
}

function queueEdit(key, value) {
  const photo = photoById(state.currentId);
  if (!photo || !state.canEditCurrent || !canEditPhoto(photo)) return;

  if (state.edit && state.edit.id !== photo.id) flushEdit();
  if (!state.edit || state.edit.id !== photo.id) {
    state.edit = { id: photo.id, patch: {}, timer: null };
  }

  photo[key] = value;
  state.edit.patch[key] = value;

  if (key !== 'caption') {
    updateCard(photo);
  }

  clearTimeout(state.edit.timer);
  state.edit.timer = setTimeout(flushEdit, 650);
}

async function flushEdit() {
  const edit = state.edit;
  state.edit = null;
  if (!edit) return;
  clearTimeout(edit.timer);

  if (!Object.keys(edit.patch).length) return;
  const photo = photoById(edit.id);
  if (!photo || !canEditPhoto(photo)) return;

  setSaveState('保存中…');
  try {
    const { error } = await client
      .from('photos')
      .update(edit.patch)
      .eq('id', edit.id);
    if (error) throw error;
    updateCard(photo);
    updateChips();
    updateStats();
    setSaveState('已保存');
  } catch (error) {
    setSaveState('保存失败');
    showToast(errorText(error, '保存失败'));
  }
}

function updateFavoriteUi(photo) {
  const pressed = Boolean(photo.favorite);
  if (state.currentId === photo.id) {
    els.lbFavorite.setAttribute('aria-pressed', String(pressed));
    $('span', els.lbFavorite).textContent = pressed ? '已收藏' : '收藏';
  }
}

/* --------------------------------------------------------------- favorite */

function toggleFavorite(photo) {
  if (state.favorites.has(photo.id)) state.favorites.delete(photo.id);
  else state.favorites.add(photo.id);

  photo.favorite = state.favorites.has(photo.id);
  saveFavorites();
  updateCard(photo);
  updateStats();
  updateFavoriteUi(photo);

  if (state.favoriteOnly) {
    if (state.currentId === photo.id && !photo.favorite) closeLightbox();
    render();
  }
}

/* ---------------------------------------------------------------- delete */

function removePhotoFromState(id) {
  state.photos = state.photos.filter((photo) => photo.id !== id);
  const card = state.cards.get(id);
  if (card) card.remove();
  state.cards.delete(id);
  render();
}

/* ----------------------------------------------------------------- upload */

function bindUpload() {
  els.uploadClose.addEventListener('click', () => {
    if (state.upload.busy) {
      showToast('正在上传，请稍候…');
      return;
    }
    closeUpload();
  });

  $('.modal-backdrop', els.uploadModal).addEventListener('click', () => {
    if (state.upload.busy) return;
    closeUpload();
  });

  els.dropzone.addEventListener('click', () => {
    if (!state.user) {
      openAuth('login');
      return;
    }
    els.fileInput.click();
  });

  els.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!state.user) openAuth('login');
      else els.fileInput.click();
    }
  });

  els.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.dropzone.classList.add('is-drag');
  });

  els.dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.dropzone.classList.remove('is-drag');
  });

  els.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    els.dropzone.classList.remove('is-drag');
    hideDragOverlay();
    if (event.dataTransfer && event.dataTransfer.files.length) {
      handleFiles(event.dataTransfer.files);
    }
  });

  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files && els.fileInput.files.length) {
      handleFiles(els.fileInput.files);
    }
    els.fileInput.value = '';
  });
}

function openUpload() {
  if (!state.user) {
    openAuth('login');
    return;
  }
  if (state.upload.busy) {
    showToast('正在上传，请稍候…');
    return;
  }

  if (!els.authModal.hidden) closeAuth();
  if (!els.lightbox.hidden) closeLightbox();
  closeUserMenu();

  if (els.uploadModal.hidden) uploadLastFocused = document.activeElement;
  resetUploadUi();
  els.uploadModal.hidden = false;
  document.body.classList.add('locked');
  setTimeout(() => els.dropzone.focus({ preventScroll: true }), 40);
}

function closeUpload() {
  if (state.upload.busy) return;
  els.uploadModal.hidden = true;
  document.body.classList.remove('locked');
  revokeQueueUrls();
  if (uploadLastFocused && document.contains(uploadLastFocused)) {
    uploadLastFocused.focus({ preventScroll: true });
  }
}

function resetUploadUi() {
  revokeQueueUrls();
  els.uploadQueue.innerHTML = '';
  els.uploadNote.textContent = '照片会压缩后上传，拍摄信息（EXIF）会一并保留。';
  els.progressWrap.hidden = true;
  els.progressBar.style.width = '0%';
  state.upload = { busy: false, total: 0, done: 0, success: 0, failed: 0, urls: [] };
}

function revokeQueueUrls() {
  for (const url of state.upload.urls) URL.revokeObjectURL(url);
  state.upload.urls = [];
}

async function handleFiles(fileList) {
  if (!state.user) {
    showToast('请先登录再上传');
    openAuth('login');
    return;
  }

  const files = [...fileList].filter(isSupportedFile);
  if (!files.length) {
    showToast('请选择 JPG、PNG 或 WebP 图片');
    return;
  }
  if (state.upload.busy) {
    showToast('正在上传，请稍候…');
    return;
  }

  if (els.uploadModal.hidden) {
    openUpload();
  } else {
    resetUploadUi();
    document.body.classList.add('locked');
  }

  state.upload.busy = true;
  state.upload.total = files.length;
  state.upload.done = 0;
  state.upload.success = 0;
  state.upload.failed = 0;
  els.progressWrap.hidden = false;
  els.progressBar.style.width = '0%';
  els.uploadNote.textContent = `正在上传 0 / ${files.length}`;

  const items = files.map((file) => createQueueItem(file));

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const item = items[index];
    try {
      await uploadSingle(file, item);
      state.upload.success += 1;
      item.markDone();
    } catch (error) {
      console.error(error);
      state.upload.failed += 1;
      item.markError(errorText(error, '上传失败'));
    }

    state.upload.done += 1;
    const percent = Math.round((state.upload.done / state.upload.total) * 100);
    els.progressBar.style.width = `${percent}%`;
    els.uploadNote.textContent = `正在上传 ${state.upload.done} / ${state.upload.total}`;
  }

  state.upload.busy = false;
  const success = state.upload.success;
  const failed = state.upload.failed;

  if (success > 0) {
    els.progressBar.style.width = '100%';
    els.uploadNote.textContent = failed
      ? `已上传 ${success} 张，${failed} 张失败。可以关闭窗口后重试失败的照片。`
      : `已上传 ${success} 张作品`;
    showToast(
      failed ? `已上传 ${success} 张，${failed} 张失败` : `已上传 ${success} 张作品`,
      { duration: failed ? 6000 : 3400 },
    );
    if (!failed) {
      setTimeout(() => {
        if (!state.upload.busy) closeUpload();
      }, 1000);
    }
  } else {
    els.uploadNote.textContent = '没有照片上传成功，请检查上面的提示。';
  }
}

function isSupportedFile(file) {
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
  if (file.type && /^image\/(jpeg|png|webp|avif)$/.test(file.type)) return true;
  return /\.(jpe?g|png|webp|avif)$/i.test(file.name);
}

function createQueueItem(file) {
  const item = document.createElement('li');
  item.className = 'queue-item';

  const thumb = document.createElement('div');
  thumb.className = 'queue-thumb';
  const previewUrl = URL.createObjectURL(file);
  state.upload.urls.push(previewUrl);
  const image = document.createElement('img');
  image.src = previewUrl;
  image.alt = '';
  thumb.append(image);

  const body = document.createElement('div');
  body.className = 'queue-body';
  const name = document.createElement('div');
  name.className = 'queue-name';
  name.textContent = file.name;
  const sub = document.createElement('div');
  sub.className = 'queue-sub';
  sub.textContent = formatSize(file.size);
  body.append(name, sub);

  const status = document.createElement('div');
  status.className = 'queue-state';
  status.textContent = '等待中';

  item.append(thumb, body, status);
  els.uploadQueue.append(item);

  return {
    setState(text, subText) {
      status.textContent = text;
      if (subText) sub.textContent = subText;
    },
    markDone() {
      item.classList.add('is-done');
      status.textContent = '完成';
    },
    markError(message) {
      item.classList.add('is-error');
      status.textContent = '失败';
      sub.textContent = message;
      sub.title = message;
    },
  };
}

async function uploadSingle(file, item) {
  if (!state.user) throw new Error('请先登录');
  item.setState('读取信息');

  if (file.size > 80 * 1024 * 1024) throw new Error('文件超过 80MB');
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    throw new Error('HEIC 格式暂不支持，请先转成 JPG');
  }

  const userId = state.user.id;
  const exif = await readExifFromFile(file);

  item.setState('解码图片');
  const source = await decodeImage(file);

  try {
    item.setState('压缩图片');
    let full = await renderJpeg(source, 2400, 0.86);
    if (full.blob.size > 9.5 * 1024 * 1024) {
      full = await renderJpeg(source, 2000, 0.75);
    }
    const thumb = await renderJpeg(source, 960, 0.8);

    const photoId = uuid();
    const fullPath = `${userId}/${photoId}.jpg`;
    const thumbPath = `${userId}/${photoId}-t.jpg`;

    item.setState('上传大图');
    const { error: fullError } = await client.storage.from(BUCKET).upload(fullPath, full.blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (fullError) throw fullError;

    item.setState('上传缩略图');
    const { error: thumbError } = await client.storage.from(BUCKET).upload(thumbPath, thumb.blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (thumbError) {
      await client.storage.from(BUCKET).remove([fullPath]);
      throw thumbError;
    }

    item.setState('保存信息');
    const { data, error } = await client
      .from('photos')
      .insert({
        owner_id: userId,
        title: titleFromFileName(file.name),
        caption: '',
        film: '',
        location: '',
        tags: [],
        width: full.width,
        height: full.height,
        exif,
        full_path: fullPath,
        thumb_path: thumbPath,
      })
      .select()
      .single();

    if (error) {
      await client.storage.from(BUCKET).remove([fullPath, thumbPath]);
      throw error;
    }

    const normalized = normalizePhoto(data);
    state.photos.unshift(normalized);
    const card = createCard(normalized);
    state.cards.set(normalized.id, card);
    els.gallery.append(card);

    updateStats();
    updateChips();
    render();
  } finally {
    if (source && typeof source.close === 'function') source.close();
  }
}

function titleFromFileName(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function readExifFromFile(file) {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return {};
  try {
    const head = await file.slice(0, 512 * 1024).arrayBuffer();
    return readExif(head);
  } catch {
    return {};
  }
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    } catch {
      /* try plain */
    }
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      };
    } catch {
      /* fall back */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('无法读取这张图片');
  }
}

async function renderJpeg(source, maxSize, quality) {
  const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('浏览器不支持图片压缩');
  context.fillStyle = '#0b0b0c';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  source.draw(context, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('图片压缩失败');

  return { blob, width, height };
}

/* ------------------------------------------------------------------ auth */

function bindAuth() {
  els.loginBtn.addEventListener('click', () => openAuth('login'));
  els.authClose.addEventListener('click', closeAuth);
  $('.modal-backdrop', els.authModal).addEventListener('click', closeAuth);

  for (const tab of els.authTabs) {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode || 'login'));
  }

  els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client) {
      showAuthError('Supabase 还没有配置好。');
      return;
    }

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    const mode = state.authMode;
    const name = els.authName.value.trim() || email.split('@')[0] || '用户';

    if (!email) {
      showAuthError('请填写邮箱。');
      els.authEmail.focus();
      return;
    }
    if (!password || password.length < 6) {
      showAuthError('密码至少需要 6 位。');
      els.authPassword.focus();
      return;
    }

    setAuthBusy(true);
    hideAuthError();

    try {
      if (mode === 'login') {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await applySession(data.session || null);
        closeAuth();
        showToast('欢迎回来');
      } else {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name.slice(0, 40) },
            emailRedirectTo: redirectUrl(),
          },
        });
        if (error) throw error;

        if (data.session) {
          await applySession(data.session);
          closeAuth();
          showToast('注册成功');
        } else {
          setAuthMode('login');
          els.authEmail.value = email;
          els.authPassword.value = '';
          els.authNote.textContent = `验证邮件已发送到 ${email}，请查收并点击链接后再登录。`;
          showToast('注册成功，请查收验证邮件');
        }
      }
    } catch (error) {
      showAuthError(errorText(error, '操作失败'));
    } finally {
      setAuthBusy(false);
    }
  });
}

function openAuth(mode = 'login') {
  if (state.user) {
    showToast('你已经登录了');
    return;
  }
  if (!els.uploadModal.hidden) closeUpload();
  if (!els.lightbox.hidden) closeLightbox();
  closeUserMenu();

  if (els.authModal.hidden) authLastFocused = document.activeElement;
  setAuthMode(mode);
  hideAuthError();
  els.authModal.hidden = false;
  document.body.classList.add('locked');
  setTimeout(() => els.authEmail.focus({ preventScroll: true }), 50);
}

function closeAuth() {
  if (els.authModal.hidden) return;
  els.authModal.hidden = true;
  document.body.classList.remove('locked');
  setAuthBusy(false);
  if (authLastFocused && document.contains(authLastFocused)) {
    authLastFocused.focus({ preventScroll: true });
  }
}

function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  const isRegister = state.authMode === 'register';

  els.authTitle.textContent = isRegister ? '注册' : '登录';
  els.authSubmit.textContent = isRegister ? '注册' : '登录';
  els.nameField.hidden = !isRegister;
  els.authName.required = isRegister;
  els.authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';
  els.authNote.textContent = isRegister
    ? '注册后会收到验证邮件，验证完再回来登录。'
    : '还没有账号？点上面的「注册」。';

  for (const tab of els.authTabs) {
    const active = tab.dataset.mode === state.authMode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }

  hideAuthError();
}

function showAuthError(message) {
  els.authError.textContent = message;
  els.authError.hidden = false;
}

function hideAuthError() {
  els.authError.hidden = true;
  els.authError.textContent = '';
}

function setAuthBusy(busy) {
  els.authSubmit.disabled = busy;
  els.authSubmit.textContent = busy
    ? '请稍候…'
    : state.authMode === 'register'
      ? '注册'
      : '登录';
}

/* ------------------------------------------------------------- drag & drop */

function bindDragAndDrop() {
  let depth = 0;

  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    depth += 1;
    els.dragOverlay.hidden = false;
  });

  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) {
      depth = 0;
      hideDragOverlay();
      return;
    }
    depth = Math.max(0, depth - 1);
    if (depth === 0) hideDragOverlay();
  });

  window.addEventListener('blur', () => {
    depth = 0;
    hideDragOverlay();
  });

  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    depth = 0;
    hideDragOverlay();
    if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
  });
}

function hideDragOverlay() {
  els.dragOverlay.hidden = true;
}

/* ---------------------------------------------------------------- keyboard */

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!els.userDropdown.hidden) {
        closeUserMenu();
        return;
      }
      if (!els.lightbox.hidden) {
        event.preventDefault();
        closeLightbox();
        return;
      }
      if (!els.authModal.hidden) {
        event.preventDefault();
        closeAuth();
        return;
      }
      if (!els.uploadModal.hidden) {
        if (state.upload.busy) {
          showToast('正在上传，请稍候…');
        } else {
          closeUpload();
        }
        return;
      }
    }

    if (!els.lightbox.hidden) {
      if (event.key === 'ArrowLeft' && !isTyping(event.target)) {
        event.preventDefault();
        navigateLightbox(-1);
        return;
      }
      if (event.key === 'ArrowRight' && !isTyping(event.target)) {
        event.preventDefault();
        navigateLightbox(1);
        return;
      }
      if ((event.key === 'f' || event.key === 'F') && !isTyping(event.target)) {
        event.preventDefault();
        const photo = photoById(state.currentId);
        if (photo) toggleFavorite(photo);
        return;
      }
      if (event.key === 'Tab') trapFocus(event);
      return;
    }

    if (!els.authModal.hidden) {
      if (event.key === 'Tab') trapFocus(event, els.authModal);
      return;
    }

    if (!els.uploadModal.hidden) {
      if (event.key === 'Tab') trapFocus(event, els.uploadModal);
      return;
    }

    if (event.key === '/' && !isTyping(event.target)) {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    }
  });
}

function trapFocus(event, container = els.lightbox) {
  const focusable = [...container.querySelectorAll(
    'button:not([disabled]), input:not([type="file"]), textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null && !element.readOnly);

  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------- boot */

function showLoadError(error) {
  console.error('[光影集] 载入失败：', error);
  state.loading = false;
  state.loadError = true;
  els.initialLoader.hidden = true;
  els.gallery.hidden = true;
  els.emptyState.hidden = false;
  els.noResults.hidden = true;
  els.emptyTitle.textContent = '画廊还没有准备好';
  els.emptyAction.hidden = true;

  const message = (error && error.message) || '';
  if (/PGRST205|Could not find the table/i.test(message)) {
    els.emptyCopy.innerHTML =
      '数据库还没有初始化。请在 Supabase 的 SQL Editor 里运行 <a href="supabase/schema.sql" target="_blank" rel="noopener">supabase/schema.sql</a>，然后刷新页面。';
  } else if (/Bucket not found/i.test(message)) {
    els.emptyCopy.textContent = '图片存储桶还没有创建，请先在 Supabase 运行 schema.sql。';
  } else {
    els.emptyCopy.textContent = '暂时无法载入作品，请检查网络后刷新页面。';
  }
}

async function init() {
  window.__GYJ_READY__ = true;

  state.favorites = loadFavorites();

  bindHeader();
  bindToolbar();
  bindLightbox();
  bindUpload();
  bindAuth();
  bindDragAndDrop();
  bindKeyboard();
  observeLayout();
  watchAuth();

  if (!client) {
    console.error('[光影集] Supabase 客户端初始化失败，请检查 config.js。');
    els.bootError.hidden = false;
    els.initialLoader.hidden = true;
    return;
  }

  const results = await Promise.allSettled([loadPhotos(), restoreSession()]);

  if (results[0].status === 'rejected') {
    showLoadError(results[0].reason);
  } else {
    state.loading = false;
    rebuildGallery();
    els.initialLoader.hidden = true;
  }

  if (results[1].status === 'rejected') {
    console.warn('[光影集] 登录状态读取失败：', results[1].reason);
    state.authReady = true;
  }

  renderAuthUi();
  els.bootError.hidden = true;
}

init();
