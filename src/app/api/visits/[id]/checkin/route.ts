import { getRequestContext } from '@cloudflare/next-on-pages';
import { checkinVisit } from '@/lib/db';

export const runtime = 'edge';

// 确认入店（店内人员扫骑手二维码后点确认，visit id 即凭证）：POST /api/visits/[id]/checkin
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;
  const result = await checkinVisit(env.DB, id);
  if (result.error === 'not_found') return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  if (result.error === 'invalid_state') {
    return Response.json({ ok: false, error: '该预约已失效（可能已过期或已取消），请重新预约' }, { status: 409 });
  }
  return Response.json({ ok: true, data: { visit: result.visit, already: 'already' in result } });
}
