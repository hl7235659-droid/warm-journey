import { getWorkOrder, updateWorkOrder } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, ROLES_CONTENT } from '@/lib/http';
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

export const PUT = withAdmin<{ id: string }>(async ({ req, env, params: { id } }) => {
  const order = await getWorkOrder(env.DB, id);
  if (!order) return jsonErr('工单不存在', 404);

  const parsed = await readJson(req, UpdateSchema);
  if (isResponse(parsed)) return parsed;

  await updateWorkOrder(env.DB, id, parsed);

  // 工单落到 resolved/closed 时，按 work_order_id 批量回写所有关联上报
  //（自动工单可能关联多条，只回写单条会让其余上报永远卡在 processing）
  if (parsed.status === 'resolved' || parsed.status === 'closed') {
    await env.DB.prepare('UPDATE reports SET status = ? WHERE work_order_id = ?')
      .bind(parsed.status, id).run();
  }

  return Response.json({ ok: true, data: { message: '工单已更新' } });
}, { roles: ROLES_CONTENT });

export const GET = withAdmin<{ id: string }>(async ({ env, params: { id } }) => {
  const order = await getWorkOrder(env.DB, id);
  if (!order) return jsonErr('工单不存在', 404);
  return Response.json({ ok: true, data: order });
});
