// Enable Cloudflare bindings (D1, R2, env vars) in local `next dev`
if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
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
