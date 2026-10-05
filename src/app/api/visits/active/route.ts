import { getRequestContext } from '@cloudflare/next-on-pages';
import { getActiveVisit } from '@/lib/db';

export const runtime = 'edge';

// 骑手在某点位的进行中 visit：GET /api/visits/active?point_id=&rider_token=
export async function GET(req: Request) {
  const { env } = getRequestContext();
  const sp = new URL(req.url).searchParams;
  const pointId = sp.get('point_id') ?? '';
  const riderToken = sp.get('rider_token') ?? '';
  if (!pointId || !/^[0-9a-f]{16,32}$/.test(riderToken)) {
    return Response.json({ ok: false, error: '参数错误' }, { status: 400 });
  }
  const visit = await getActiveVisit(env.DB, pointId, riderToken);
  return Response.json({ ok: true, data: { visit } });
}
