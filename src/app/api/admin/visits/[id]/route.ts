import { getRequestContext } from '@cloudflare/next-on-pages';
import { checkoutVisit } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

const ActionSchema = z.object({
  action: z.literal('force_checkout'),
});

// 管理端操作 visit：PUT /api/admin/visits/[id] { action: 'force_checkout' }
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '不支持的操作' }, { status: 422 });

  const result = await checkoutVisit(env.DB, id); // 无 rider_token = 管理端强制
  if (result.error === 'not_found') return Response.json({ ok: false, error: '记录不存在' }, { status: 404 });
  if (result.error === 'invalid_state') return Response.json({ ok: false, error: '该记录不在在店状态' }, { status: 409 });
  return Response.json({ ok: true, data: { visit: result.visit } });
}
