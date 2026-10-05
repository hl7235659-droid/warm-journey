import { getRequestContext } from '@cloudflare/next-on-pages';
import { getAdminByUsername, updateLastLogin, checkRateLimit } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { readJson, isResponse, getClientIp } from '@/lib/http';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const runtime = 'edge';

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();

  // 登录频控：每 IP 5 分钟内最多 10 次，阻断无限爆破
  const ip = getClientIp(req);
  try {
    if (!(await checkRateLimit(env.DB, `login:${ip}`, { limit: 10, windowSec: 300 }))) {
      return Response.json({ ok: false, error: '尝试过于频繁，请稍后再试' }, { status: 429 });
    }
  } catch (e) {
    // D1 抖动时放行：限流器故障不应把全体管理员锁在门外
    console.error('login rate limit unavailable:', (e as { message?: string })?.message ?? 'unknown');
  }

  const parsed = await readJson(req, LoginSchema);
  if (isResponse(parsed)) return parsed;

  const { username, password } = parsed;
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

  // HTTPS 站点必须带 Secure：防止 Cookie 经明文 HTTP 泄露
  const isHttps = new URL(req.url).protocol === 'https:';
  const cookieAttrs = `wj_admin=${token}; Path=/; HttpOnly;${isHttps ? ' Secure;' : ''} SameSite=Strict; Max-Age=28800`;

  return new Response(JSON.stringify({ ok: true, data: { token, user: {
    id: user.id, username: user.username, role: user.role, display_name: user.display_name,
  } } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // HttpOnly cookie so the browser sends it automatically
      'Set-Cookie': cookieAttrs,
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
