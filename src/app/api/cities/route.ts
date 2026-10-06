import { getCloudflareContext } from '@opennextjs/cloudflare';
import { listEnabledCities } from '@/lib/db';

// 公开：已开通城市列表（首页筛选用）
export async function GET() {
  const { env } = getCloudflareContext();
  const cities = await listEnabledCities(env.DB);
  return Response.json({ ok: true, data: cities });
}
