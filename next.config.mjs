// Enable Cloudflare bindings (D1, R2, env vars) in local `next dev`
if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // 用 HTTP 307 重定向，而不是在 server component 里调 redirect()。
      // admin/layout.tsx 是客户端组件，其下再走服务端 redirect 会让
      // Next 15 客户端路由抛 React error #310（Rendered more hooks...）。
      { source: '/admin', destination: '/admin/points', permanent: false },
    ];
  },

  async headers() {
    return [
      {
        // 静态资源走 Cloudflare Pages 资源层（内容哈希 + immutable），不要覆盖。
        // 其余（HTML / RSC / API）一律不缓存：否则改了布局，手机上还是旧页面。
        source: '/((?!_next/static|_next/image|favicon\\.svg|manifest\\.json).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
