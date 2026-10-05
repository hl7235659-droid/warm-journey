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
        // 静态资源走 Cloudflare Pages 资源层（内容哈希 + etag），不要覆盖。
        // images/ 是本站的装饰与封面位图，同属静态资源；其余（HTML / RSC / API）一律不缓存：
        // 否则改了布局，手机上还是旧页面。
        source: '/((?!_next/static|images|manifest\\.json).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
