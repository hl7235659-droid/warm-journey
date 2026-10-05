import { getRequestContext } from '@cloudflare/next-on-pages';
import { cancelVisit } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'edge';

const CancelSchema = z.object({
  rider_token: z.string().regex(/^[0-9a-f]{16,32}$/),
});

// 取消预约（骑手本人）：POST /api/visits/[id]/cancel
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  const result = await cancelVisit(env.DB, id, parsed.data.rider_token);
  if (result.error === 'not_found') return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  if (result.error === 'forbidden') return Response.json({ ok: false, error: '只能取消自己的预约' }, { status: 403 });
  if (result.error === 'invalid_state') return Response.json({ ok: false, error: '当前状态无法取消' }, { status: 409 });
  return Response.json({ ok: true, data: { visit: result.visit } });
}
