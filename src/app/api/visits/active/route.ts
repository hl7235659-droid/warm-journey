import { getRequestContext } from '@cloudflare/next-on-pages';
import { getActiveVisit } from '@/lib/db';
import { readJson, isResponse, RiderTokenSchema } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

// 骑手在某点位的进行中 visit：POST /api/visits/active
// 凭证走 JSON body 而非 URL query——query 会落入浏览器历史 / 代理 / CDN 日志。
const ActiveSchema = z.object({
  point_id: z.string().min(1).max(64),
  rider_token: RiderTokenSchema,
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const parsed = await readJson(req, ActiveSchema);
  if (isResponse(parsed)) return parsed;
  const visit = await getActiveVisit(env.DB, parsed.point_id, parsed.rider_token);
  return Response.json({ ok: true, data: { visit } });
}
