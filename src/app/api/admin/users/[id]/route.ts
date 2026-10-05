import { getRequestContext } from '@cloudflare/next-on-pages';
import { updateAdmin, deleteAdmin } from '@/lib/db';
import { requireAdmin, requireRole } from '@/lib/auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const runtime = 'edge';

const UpdateSchema = z.object({
  password: z.string().min(6).max(64).optional(),
  role: z.enum(['super_admin', 'admin', 'inspector']).optional(),
  display_name: z.string().max(32).optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin']);
  if (forbidden) return forbidden;

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  const data: { password_hash?: string; role?: string; display_name?: string } = {};
  if (parsed.data.password) data.password_hash = await bcrypt.hash(parsed.data.password, 10);
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.display_name !== undefined) data.display_name = parsed.data.display_name;

  await updateAdmin(env.DB, id, data);
  return Response.json({ ok: true, data: { message: '更新成功' } });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin']);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (id === auth.sub) {
    return Response.json({ ok: false, error: '不能删除当前登录账号' }, { status: 400 });
  }
  await deleteAdmin(env.DB, id);
  return Response.json({ ok: true, data: { message: '已删除' } });
}
