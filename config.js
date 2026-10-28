/**
 * 公开的前端配置。
 *
 * 这里使用的是 Supabase 的 publishable key（等同于旧版 anon key），
 * 它本来就是给浏览器公开使用的，可以安全地提交到仓库。
 *
 * 绝对不要把 service_role / secret key 写进这个文件。
 */
window.GYJ_CONFIG = {
  supabaseUrl: 'https://mqachwhlbkcrlbzhjngz.supabase.co',
  supabaseKey: 'sb_publishable_c1G7mgBpcks1AVvf2Oq7dA_84-PVnVl',
  bucket: 'photos',
};
