import { getRequestContext } from '@cloudflare/next-on-pages';
import { getVisit, getOccupancy } from '@/lib/db';

export const runtime = 'edge';

// 查询 visit（入店确认页用，id 即凭证）：GET /api/visits/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;
  const visit = await getVisit(env.DB, id);
  if (!visit) return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  const occupancy = await getOccupancy(env.DB, visit.point_id);
  // 不下发完整 rider_token，防旁观者可操作
  return Response.json({
    ok: true,
    data: { visit: { ...visit, rider_token: visit.rider_token.slice(0, 6) + '…' }, occupancy },
  });
}
