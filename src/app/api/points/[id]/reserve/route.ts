import { getRequestContext } from '@cloudflare/next-on-pages';
import { getPoint, reserveVisit } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'edge';

const ReserveSchema = z.object({
  rider_token: z.string().regex(/^[0-9a-f]{16,32}$/),
});

// 预约进店：POST /api/points/[id]/reserve
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
  const parsed = ReserveSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });
  if (point.status === 'closed') return Response.json({ ok: false, error: '该站点已关闭，无法预约' }, { status: 409 });

  const result = await reserveVisit(env.DB, id, parsed.data.rider_token);
  if ('full' in result && result.full) {
    return Response.json({ ok: false, error: '当前名额已满，请稍后再试', code: 'FULL' }, { status: 409 });
  }
  return Response.json({ ok: true, data: { visit: result.visit, created: result.created } }, { status: result.created ? 201 : 200 });
}
