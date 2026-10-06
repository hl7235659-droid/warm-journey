import { SignJWT, jwtVerify } from 'jose';

const ALG = 'HS256';
const EXPIRY = '8h';

// 密钥只从环境变量读取，绝不兜底公开字符串：缺失时直接抛错（fail-loud），
// 防止生产环境用已知密钥签发 token。部署时必须：
//   npx wrangler secret put JWT_SECRET
function getSecret(env?: { JWT_SECRET?: string }) {
  const raw = env?.JWT_SECRET ?? process.env.JWT_SECRET;
  if (!raw) throw new Error('JWT_SECRET 未配置：请通过 npx wrangler secret put JWT_SECRET 注入高熵密钥');
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

async function verifyToken(
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

function getTokenFromRequest(req: Request): string | null {
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

// 高风险路由专用：JWT 校验之外回查 DB，确认账号仍存在且角色未变。
// 缓解 token 8 小时内不可撤销的问题（删除用户 / 降级后旧 token 立即失效）。
export async function requireActiveAdmin(
  req: Request,
  env: { JWT_SECRET?: string; DB: D1Database },
): Promise<AdminPayload | Response> {
  const payload = await requireAdmin(req, env);
  if (payload instanceof Response) return payload;
  try {
    const user = await env.DB.prepare('SELECT id, role FROM admin_users WHERE id = ?')
      .bind(payload.sub).first<{ id: string; role: string }>();
    if (!user || user.role !== payload.role) {
      return new Response(JSON.stringify({ ok: false, error: '账号状态已变更，请重新登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '服务暂不可用' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return payload;
}

// 角色校验：在 requireAdmin 之后调用。返回 null 表示通过，否则返回 403 响应。
export function requireRole(payload: AdminPayload, roles: readonly string[]): Response | null {
  if (roles.includes(payload.role)) return null;
  return new Response(JSON.stringify({ ok: false, error: '权限不足' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
