import { getRequestContext } from '@cloudflare/next-on-pages';
import { listAdmins, createAdmin, getAdminByUsername } from '@/lib/db';
import { requireAdmin, requireRole } from '@/lib/auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin']);
  if (forbidden) return forbidden;

  const users = await listAdmins(env.DB);
  return Response.json({ ok: true, data: users });
}

const CreateSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/, '用户名仅限字母、数字、下划线'),
  password: z.string().min(6).max(64),
  role: z.enum(['super_admin', 'admin', 'inspector']).default('inspector'),
  display_name: z.string().max(32).default(''),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin']);
  if (forbidden) return forbidden;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: '参数验证失败', details: parsed.error.flatten() }, { status: 422 });
  }

  const existing = await getAdminByUsername(env.DB, parsed.data.username);
  if (existing) return Response.json({ ok: false, error: '用户名已存在' }, { status: 409 });

  const password_hash = await bcrypt.hash(parsed.data.password, 10);
  const id = await createAdmin(env.DB, {
    username: parsed.data.username,
    password_hash,
    role: parsed.data.role,
    display_name: parsed.data.display_name || parsed.data.username,
  });
  return Response.json({ ok: true, data: { id } }, { status: 201 });
}
