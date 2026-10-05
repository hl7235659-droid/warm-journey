import { getRequestContext } from '@cloudflare/next-on-pages';
import { getVisit, getOccupancy, checkRateLimit } from '@/lib/db';
import { getClientIp } from '@/lib/http';

export const runtime = 'edge';

// 查询 visit（入店确认页用，id 即凭证）：GET /api/visits/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();

  // 与 checkin 同源凭证：同样限流，防止批量探测 visit id
  if (!(await checkRateLimit(env.DB, `visit:${getClientIp(req)}`, { limit: 20, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '查询过于频繁，请稍后再试' }, { status: 429 });
  }

  const { id } = await params;
  const visit = await getVisit(env.DB, id);
  if (!visit) return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  const occupancy = await getOccupancy(env.DB, visit.point_id);
  // 不下发完整 rider_token / checkin_code / created_ip，防旁观者可操作或远程代确认
  const { rider_token, created_ip, checkin_code, ...safeVisit } = visit;
  return Response.json({
    ok: true,
    data: { visit: { ...safeVisit, rider_token: rider_token.slice(0, 6) + '…' }, occupancy },
  });
}
