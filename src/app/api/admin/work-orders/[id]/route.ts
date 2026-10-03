import { getRequestContext } from '@cloudflare/next-on-pages';
import { getWorkOrder, updateWorkOrder, updateReport } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

const UpdateSchema = z.object({
  title:           z.string().min(1).max(100).optional(),
  description:     z.string().optional(),
  assigned_to:     z.string().nullable().optional(),
  status:          z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority:        z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  resolution_note: z.string().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const order = await getWorkOrder(env.DB, id);
  if (!order) return Response.json({ ok: false, error: '工单不存在' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  await updateWorkOrder(env.DB, id, parsed.data);

  // Sync linked report status when work order resolves
  if (parsed.data.status === 'resolved' && order.report_id) {
    await updateReport(env.DB, order.report_id, { status: 'resolved' });
  }
  if (parsed.data.status === 'closed' && order.report_id) {
    await updateReport(env.DB, order.report_id, { status: 'closed' });
  }

  return Response.json({ ok: true, data: { message: '工单已更新' } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;
  const order = await getWorkOrder(env.DB, id);
  if (!order) return Response.json({ ok: false, error: '工单不存在' }, { status: 404 });
  return Response.json({ ok: true, data: order });
}
