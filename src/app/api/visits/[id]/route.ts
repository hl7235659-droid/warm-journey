import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getVisit, checkRateLimit } from '@/lib/db';
import { getClientIp } from '@/lib/http';

// 查询 visit（入店确认页用，id 即凭证）：GET /api/visits/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getCloudflareContext();

  // 与 checkin 同源凭证：同样限流，防止批量探测 visit id
  if (!(await checkRateLimit(env.DB, `visit:${getClientIp(req)}`, { limit: 20, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '查询过于频繁，请稍后再试' }, { status: 429 });
  }

  const { id } = await params;
  const visit = await getVisit(env.DB, id);
  if (!visit) return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  // 不下发完整 rider_token / checkin_code / created_ip，防旁观者可操作或远程代确认
  const { rider_token, created_ip, checkin_code, ...safeVisit } = visit;
  // occupancy 不在这里：两个真实消费者（入店确认页、AI route action）都只读 .visit，
  // 每次为它们多跑 5 条 D1 语句换不来一个读取方。需要占用数字的骑手详情页
  // 走 /api/visits/active（P2-20）。
  return Response.json({
    ok: true,
    data: { visit: { ...safeVisit, rider_token: rider_token.slice(0, 6) + '…' } },
  });
}
