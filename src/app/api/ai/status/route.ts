import { getCloudflareContext } from '@opennextjs/cloudflare';
import { resolveServerProvider } from '@/lib/ai/fetch';

// GET /api/ai/status — 悬浮窗徽章用：服务端有没有可用的兜底提供商。
// 判据与 /api/ai/chat 的转发前解析共用（resolveServerProvider），所以徽章不会
// 比真实链路更乐观。刻意只下发布尔值：用的是哪家模型、什么地址、什么密钥，
// 都是服务器实现细节，不该出现在一个匿名可访问的公开接口上。
// 纯读环境变量：不查库、不出站，因此无需限流。
export async function GET() {
  const { env } = getCloudflareContext();
  return Response.json({ ok: true, data: { ready: resolveServerProvider(env) !== null } });
}
