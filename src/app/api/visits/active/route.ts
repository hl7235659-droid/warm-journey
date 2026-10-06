import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getRiderVisitState } from '@/lib/db';
import { readJson, isResponse, RiderTokenSchema } from '@/lib/http';
import { sanitizeVisit } from '@/lib/visit-sanitize';
import { z } from 'zod';

// 骑手在某点位的进行中 visit + 实时占用：POST /api/visits/active
// 凭证走 JSON body 而非 URL query——query 会落入浏览器历史 / 代理 / CDN 日志。
const ActiveSchema = z.object({
  point_id: z.string().min(1).max(64),
  rider_token: RiderTokenSchema,
});

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  const parsed = await readJson(req, ActiveSchema);
  if (isResponse(parsed)) return parsed;
  const { visit, occupancy } = await getRiderVisitState(env.DB, parsed.point_id, parsed.rider_token);
  // keepCode：rider_token 已匹配（查询本身就按 token 过滤），VisitCard 要靠它渲染入店二维码；
  // rider_token / created_ip 仍然剥离——响应回到浏览器，不该再带出一份凭证。
  return Response.json({
    ok: true,
    data: { visit: visit ? sanitizeVisit(visit, { keepCode: true }) : null, occupancy },
  });
}
