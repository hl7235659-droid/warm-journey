import { getRequestContext } from '@cloudflare/next-on-pages';
import { getAdminByUsername, updateLastLogin } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const runtime = 'edge';

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '用户名和密码不能为空' }, { status: 422 });

  const { username, password } = parsed.data;
  const user = await getAdminByUsername(env.DB, username);

  if (!user) {
    // constant-time comparison even on miss
    await bcrypt.compare(password, '$2b$10$invalid.hash.to.prevent.timing.attacks.00000000000000');
    return Response.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return Response.json({ ok: false, error: '用户名或密码错误' }, { status: 401 });

  await updateLastLogin(env.DB, user.id);

  const jwtEnv = env as unknown as { JWT_SECRET?: string };
  const token = await signToken(
    { sub: user.id, username: user.username, role: user.role, display_name: user.display_name },
    jwtEnv,
  );

  return new Response(JSON.stringify({ ok: true, data: { token, user: {
    id: user.id, username: user.username, role: user.role, display_name: user.display_name,
  } } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // HttpOnly cookie so the browser sends it automatically
      'Set-Cookie': `wj_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`,
    },
  });
}

export async function DELETE() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'wj_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    },
  });
}
