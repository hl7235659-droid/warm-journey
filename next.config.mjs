// Enable Cloudflare bindings (D1, R2, env vars) in local `next dev`
if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
