import { checkoutVisit } from '@/lib/db';
import { withAdmin, readJson, isResponse } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

const ActionSchema = z.object({
  action: z.literal('force_checkout'),
});

// 管理端强制离店：影响骑手占用状态，限管理员及以上
export const PUT = withAdmin<{ id: string }>(async ({ req, env, params: { id } }) => {
  const parsed = await readJson(req, ActionSchema);
  if (isResponse(parsed)) return parsed;

  const result = await checkoutVisit(env.DB, id); // 无 rider_token = 管理端强制
  if (result.error === 'not_found') return Response.json({ ok: false, error: '记录不存在' }, { status: 404 });
  if (result.error === 'invalid_state') return Response.json({ ok: false, error: '该记录不在在店状态' }, { status: 409 });
  return Response.json({ ok: true, data: { visit: result.visit } });
}, { roles: ['super_admin', 'admin'] });
