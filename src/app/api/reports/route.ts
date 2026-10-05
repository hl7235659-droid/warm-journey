import { getRequestContext } from '@cloudflare/next-on-pages';
import { createReport, getPoint, maybeAutoCreateWorkOrder } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'edge';

const ReportSchema = z.object({
  point_id: z.string().min(1),
  category: z.enum(['closed', 'info_wrong', 'facility', 'safety', 'other']),
  content:  z.string().min(5).max(500),
  // 只允许 /api/upload 签发的 key，防止任意注入
  images:   z.array(z.string().regex(/^img\/\d{4}-\d{2}\/[0-9a-f]{16}\.(jpg|png|webp|gif)$/)).max(3).default([]),
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

  const reportId = await createReport(env.DB, parsed.data);

  // 同一点位待核实上报达到阈值 → 自动开工单并关联
  const autoOrderId = await maybeAutoCreateWorkOrder(env.DB, parsed.data.point_id);

  return Response.json({
    ok: true,
    data: { message: '上报成功，感谢您的反馈', report_id: reportId, auto_order_id: autoOrderId },
  }, { status: 201 });
}
