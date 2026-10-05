import { getRequestContext } from '@cloudflare/next-on-pages';
import { listEnabledCities } from '@/lib/db';

export const runtime = 'edge';

// 公开：已开通城市列表（首页筛选用）
export async function GET() {
  const { env } = getRequestContext();
  const cities = await listEnabledCities(env.DB);
  return Response.json({ ok: true, data: cities });
}
