import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getAdminByUsername, updateLastLogin, checkRateLimit } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { readJson, isResponse, getClientIp, jsonErr } from '@/lib/http';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

// 会话 cookie 一处生成，登录与注销共用同一串属性：
// Secure 防明文泄露；__Host- 前缀让浏览器强制 Secure + Path=/ + 无 Domain，
// 顺带堵死子域投毒同名 cookie。本地 http dev 会拒收该前缀，所以按协议回落普通名，
// 读取侧见 src/lib/auth.ts getTokenFromRequest（两个名字都认）。
function sessionCookie(req: Request, value: string, maxAge: number) {
  const secure = new URL(req.url).protocol === 'https:';
  const name = secure ? '__Host-wj_admin' : 'wj_admin';
  return `${name}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=${maxAge}`;
}

export async function POST(req: Request) {
  const { env } = getCloudflareContext();

  // 登录频控：每 IP 5 分钟内最多 10 次，阻断无限爆破
  const ip = getClientIp(req);
  try {
    if (!(await checkRateLimit(env.DB, `login:${ip}`, { limit: 10, windowSec: 300 }))) {
      return jsonErr('尝试过于频繁，请稍后再试', 429);
    }
  } catch (e) {
    // fail-closed：checkRateLimit 与下一步的 getAdminByUsername 用的是同一个 D1，
    // D1 挂了登录本来就完不成，放行换来的只是无节流爆破窗口，不换来任何可用性。
    console.error('login rate limit unavailable:', (e as { message?: string })?.message ?? 'unknown');
    return jsonErr('登录服务暂时不可用，请稍后再试', 503);
  }

  const parsed = await readJson(req, LoginSchema);
  if (isResponse(parsed)) return parsed;

  const { username, password } = parsed;
  const user = await getAdminByUsername(env.DB, username);

  if (!user) {
    // constant-time comparison even on miss
    await bcrypt.compare(password, '$2b$10$invalid.hash.to.prevent.timing.attacks.00000000000000');
    return jsonErr('用户名或密码错误', 401);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return jsonErr('用户名或密码错误', 401);

  await updateLastLogin(env.DB, user.id);

  const token = await signToken(
    { sub: user.id, username: user.username, role: user.role, display_name: user.display_name },
    env,
  );

  // 登录态 cookie 一条串由 sessionCookie() 统一生成，登录与注销两处属性必须一致
  return new Response(JSON.stringify({ ok: true, data: { token, user: {
    id: user.id, username: user.username, role: user.role, display_name: user.display_name,
  } } }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // HttpOnly cookie so the browser sends it automatically
      'Set-Cookie': sessionCookie(req, token, 28800),
    },
  });
}

export async function DELETE(req: Request) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(req, '', 0),
    },
  });
}
