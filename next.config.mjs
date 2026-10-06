// Enable Cloudflare bindings (D1, R2, env vars) in local `next dev`
// via the OpenNext adapter (replaces the old next-on-pages setupDevPlatform).
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // 静态资源由 Workers 资产层服务（缓存规则见 public/_headers），不在此覆盖。
        // images/ 是本站的装饰与封面位图，同属静态资源；其余（HTML / RSC / API）一律不缓存：
        // 否则改了布局，手机上还是旧页面。
        source: '/((?!_next/static|images|manifest\\.json).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
