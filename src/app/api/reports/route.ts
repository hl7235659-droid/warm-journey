import { getRequestContext } from '@cloudflare/next-on-pages';
import { createReport, getPoint } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'edge';

const ReportSchema = z.object({
  point_id: z.string().min(1),
  category: z.enum(['closed', 'info_wrong', 'facility', 'safety', 'other']),
  content:  z.string().min(5).max(500),
  images:   z.array(z.string()).max(3).default([]),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: '参数验证失败', details: parsed.error.flatten() }, { status: 422 });
  }

  const point = await getPoint(env.DB, parsed.data.point_id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  await createReport(env.DB, parsed.data);
  return Response.json({ ok: true, data: { message: '上报成功，感谢您的反馈' } }, { status: 201 });
}
