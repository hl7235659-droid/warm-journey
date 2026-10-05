// 暖途同行 Service Worker — 离线可看站点列表
// 策略：API（点列表/城市）network-first 回退缓存；静态资源 cache-first；HTML network-first。
const VERSION = 'wj-v1';
const SHELL = ['/', '/manifest.json'];

// 所有写缓存走这里。next.config.mjs 给 HTML/API 下发 no-store，而 Cache API 拒绝把
// no-store 响应入库（put / addAll 抛 TypeError）——不剥掉这层头，离线兜底根本不成立。
// 剥头副本只影响"断网时能不能回退"：在线仍是 network-first，每次先取网络，
// 缓存仅作 catch 分支的兜底，不会把旧页面推给用户。
async function stash(key, res) {
  if (!res.ok) return;
  try {
    const headers = new Headers(res.headers);
    headers.delete('cache-control');
    headers.delete('pragma');
    const body = await res.clone().arrayBuffer();
    const cache = await caches.open(VERSION);
    await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
  } catch {
    // 不可缓存 / 配额满 / 跨 URL 键被拒：放弃这一条，离线能力降级但不影响在线使用
  }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    for (const path of SHELL) {
      const res = await fetch(path).catch(() => null);
      if (res) await stash(new URL(path, location.origin).href, res);
    }
    await self.skipWaiting();
  })());
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

  // 管理端、上传不缓存；/checkin/{id}?c=入店码 与 /checkout 是一句话凭证页——
  // URL 本身就是可代他人入店的凭据，缓存键又必须带 query 才能对上，落进 Cache Storage
  // 等于把骑手的一次性入店码长期留在店内这台设备上，断网刷新还会吐出旧凭证。
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin') ||
      url.pathname.startsWith('/api/upload') ||
      url.pathname.startsWith('/checkin') || url.pathname.startsWith('/checkout')) {
    return;
  }

  // 公开 API：network-first，离线回退缓存（键带 query：不同筛选是不同载荷）
  if (url.pathname.startsWith('/api/points') || url.pathname.startsWith('/api/cities')) {
    e.respondWith(
      fetch(e.request)
        .then(res => { void stash(e.request.url, res); return res; })
        .catch(() => caches.match(e.request).then(hit => hit || Response.json({ ok: false, error: '离线且无缓存' }, { status: 503 }))),
    );
    return;
  }

  // 静态与图片：cache-first
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/images/') || url.pathname.startsWith('/api/images/')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        void stash(e.request.url, res);
        return res;
      })),
    );
    return;
  }

  // HTML 页面：network-first，离线回退缓存。缓存键去掉 query——同一页面的不同参数
  // （?city=广州、?q=xx）共享一份离线壳，否则每个筛选组合各存一份整页 HTML。
  if (e.request.headers.get('accept')?.includes('text/html')) {
    const shellKey = url.origin + url.pathname;
    e.respondWith(
      fetch(e.request)
        .then(res => { void stash(shellKey, res); return res; })
        .catch(() => caches.match(shellKey)),
    );
  }
});
