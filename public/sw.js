// 暖途同行 Service Worker — 离线可看站点列表
// 策略：API（点列表/城市）network-first 回退缓存；静态资源 cache-first；HTML network-first。
const VERSION = 'wj-v1';
const SHELL = ['/', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 管理端与上传不缓存
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/upload')) {
    return;
  }

  // 公开 API：network-first，离线回退缓存
  if (url.pathname.startsWith('/api/points') || url.pathname.startsWith('/api/cities')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || Response.json({ ok: false, error: '离线且无缓存' }, { status: 503 }))),
    );
    return;
  }

  // 静态与图片：cache-first
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/images/') || url.pathname.startsWith('/api/images/')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })),
    );
    return;
  }

  // HTML 页面：network-first，离线回退缓存
  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request)),
    );
  }
});
