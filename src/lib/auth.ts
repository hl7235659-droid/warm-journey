import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';
const EXPIRY = '8h';

function getSecret(env?: { JWT_SECRET?: string }) {
  const raw = env?.JWT_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me';
  return new TextEncoder().encode(raw);
}

export interface AdminPayload {
  sub: string;       // admin user id
  username: string;
  role: string;
  display_name: string;
}

export async function signToken(payload: AdminPayload, env?: { JWT_SECRET?: string }) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret(env));
}

export async function verifyToken(
  token: string,
  env?: { JWT_SECRET?: string },
): Promise<AdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(env));
    return payload as unknown as AdminPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)wj_admin=([^;]+)/);
  return match ? match[1] : null;
}

export async function requireAdmin(
  req: Request,
  env?: { JWT_SECRET?: string },
): Promise<AdminPayload | Response> {
  const token = getTokenFromRequest(req);
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: '未登录' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const payload = await verifyToken(token, env);
  if (!payload) {
    return new Response(JSON.stringify({ ok: false, error: 'Token 无效或已过期' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return payload;
}

// 角色校验：在 requireAdmin 之后调用。返回 null 表示通过，否则返回 403 响应。
export function requireRole(payload: AdminPayload, roles: string[]): Response | null {
  if (roles.includes(payload.role)) return null;
  return new Response(JSON.stringify({ ok: false, error: '权限不足' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
