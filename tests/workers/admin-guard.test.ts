// 4-1 · withAdmin 表驱动单测（对应 10-05 致命事故 2.3「写路由漏鉴权」与本次 M7/L11）
// 这里锁的是"入口守卫"本身：只要路由经 withAdmin 包裹，四类拒绝必须成立。
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { ROLES_CONTENT, ROLES_SUPER, withAdmin } from '@/lib/http';
import {
  adminToken, authHeaders, changeAdminRole, deleteAdmin, installCloudflareContext,
  applySchema, rawToken, seedAdmin,
} from './_helpers';

type Ctx = { params: Promise<Record<string, string>> };
const ctx: Ctx = { params: Promise.resolve({}) };

const okHandler = withAdmin(async ({ auth }) => Response.json({ ok: true, sub: auth.sub }), {});
const contentWrite = withAdmin(
  async ({ auth }) => Response.json({ ok: true, sub: auth.sub }),
  { roles: ROLES_CONTENT, active: true },
);
const superWrite = withAdmin(
  async ({ auth }) => Response.json({ ok: true, sub: auth.sub }),
  { roles: ROLES_SUPER, active: true },
);
const readRoute = withAdmin(async ({ auth }) => Response.json({ ok: true, sub: auth.sub }), {
  roles: ROLES_CONTENT,
});

async function call(route: (req: Request, ctx: Ctx) => Promise<Response>, token: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `__Host-wj_admin=${token}`;
  const res = await route(new Request('http://warm-journey.test/api/admin/anything', { headers }), ctx);
  return { status: res.status, body: await res.json() as { ok: boolean; error?: string; sub?: string } };
}

beforeAll(async () => {
  installCloudflareContext();
  await applySchema();
});

describe('拒绝面：无凭证 / 假凭证', () => {
  it('无 cookie → 401 未登录', async () => {
    const { status, body } = await call(okHandler, null);
    expect(status).toBe(401);
    expect(body.error).toBe('未登录');
  });

  it('空 cookie 头同样按未登录处理', async () => {
    const res = await okHandler(
      new Request('http://warm-journey.test/api/admin/anything', { headers: { cookie: '' } }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('别的密钥签出来的 token → 401', async () => {
    const payload = await seedAdmin({ sub: 'admin0000forged', username: 'forged_admin' });
    const forged = await rawToken(payload, { secret: 'another-secret-entirely' });
    const { status, body } = await call(contentWrite, forged);
    expect(status).toBe(401);
    expect(body.error).toBe('Token 无效或已过期');
  });

  it('过期 token → 401（8h 窗口之外不接受）', async () => {
    const payload = await seedAdmin({ sub: 'admin0000stale', username: 'stale_admin' });
    const stale = await rawToken(payload, { expiresInSec: -60 });
    const { status } = await call(contentWrite, stale);
    expect(status).toBe(401);
  });

  // L11：jwtVerify 显式钉死 HS256 后，alg:none 的"算法降级"token 必须验不过
  it('alg 为 none 的伪造 token → 401', async () => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/, '');
    const body = btoa(JSON.stringify({
      sub: 'admin0000seed01', username: 'seed_admin', role: 'super_admin', display_name: 'x',
    })).replace(/=+$/, '');
    const { status } = await call(contentWrite, `${header}.${body}.`);
    expect(status).toBe(401);
  });

  it('密钥缺失时不兜底公开字符串：签发直接抛（fail-loud）', async () => {
    // auth.ts 的取值顺序是 env.JWT_SECRET ?? process.env.JWT_SECRET，
    // 本地 workerd 会把 .dev.vars 同时灌进 process.env，所以两处都要腾空才是"缺密钥"现场。
    const { signToken } = await import('@/lib/auth');
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const payload = { sub: 'x', username: 'x', role: 'admin', display_name: 'x' };
      await expect(signToken(payload, { JWT_SECRET: undefined })).rejects.toThrow(/JWT_SECRET/);
    } finally {
      if (saved !== undefined) process.env.JWT_SECRET = saved;
    }
  });
});

describe('角色矩阵：读写路由各按声明放行', () => {
  const roles = ['super_admin', 'admin', 'inspector'] as const;

  const table: Array<{ route: typeof okHandler; allow: readonly string[]; label: string; key: string }> = [
    { route: readRoute, allow: ROLES_CONTENT, label: '读路由 roles=ROLES_CONTENT', key: 'rd' },
    { route: contentWrite, allow: ROLES_CONTENT, label: '内容写路由 roles=ROLES_CONTENT', key: 'cw' },
    { route: superWrite, allow: ROLES_SUPER, label: '超管写路由 roles=ROLES_SUPER', key: 'sp' },
  ];

  for (const { route, allow, label, key } of table) {
    for (const role of roles) {
      it(`${label} + ${role} → ${allow.includes(role) ? '放行' : '403'}`, async () => {
        const payload = await seedAdmin({ sub: `admin${key}${role}`, username: `${key}_${role}`, role });
        const token = await adminToken(payload);
        const { status, body } = await call(route, token);
        if (allow.includes(role)) {
          expect(status).toBe(200);
          expect(body.sub).toBe(payload.sub);
        } else {
          expect(status).toBe(403);
          expect(body.error).toBe('权限不足');
        }
      });
    }
  }

  it('不声明 roles = 任意已登录管理员可读（三种角色都 200）', async () => {
    for (const role of roles) {
      const payload = await seedAdmin({ sub: `admin9${role}`, username: `loose_${role}`, role });
      const token = await adminToken(payload);
      const { status } = await call(okHandler, token);
      expect(status).toBe(200);
    }
  });

  it('token 里的角色不改库也能过：身份取自 JWT，active 才回查库', async () => {
    const payload = await seedAdmin({ sub: 'admin0000nosync', username: 'nosync', role: 'inspector' });
    const asAdmin = await adminToken({ ...payload, role: 'admin' });
    const { status } = await call(readRoute, asAdmin);
    expect(status).toBe(200);
  });
});

describe('M7 撤销窗口：active:true 必须回查数据库', () => {
  it('不带 active：账号已删，旧 token 照样过（这正是 8h 撤销窗口）', async () => {
    const payload = await seedAdmin({ sub: 'admin0000ghost', username: 'ghost_no_active', role: 'admin' });
    const token = await adminToken(payload);
    await deleteAdmin(payload.sub);
    const { status } = await call(readRoute, token);
    expect(status).toBe(200);
  });

  it('写路由 + 账号已删 → 401 账号状态已变更', async () => {
    const payload = await seedAdmin({ sub: 'admin0000dead', username: 'dead_admin', role: 'admin' });
    const token = await adminToken(payload);
    await deleteAdmin(payload.sub);
    const { status, body } = await call(contentWrite, token);
    expect(status).toBe(401);
    expect(body.error).toBe('账号状态已变更，请重新登录');
  });

  it('写路由 + 被降级（admin→inspector）→ 401，旧的高权限 token 立即作废', async () => {
    const payload = await seedAdmin({ sub: 'admin0000demt', username: 'demoted_admin', role: 'admin' });
    const token = await adminToken(payload);
    await changeAdminRole(payload.sub, 'inspector');
    const { status, body } = await call(contentWrite, token);
    expect(status).toBe(401);
    expect(body.error).toBe('账号状态已变更，请重新登录');
  });

  it('写路由 + 账号健在 → 200（active 回查不得把好用户一起拦掉）', async () => {
    const payload = await seedAdmin({ sub: 'admin0000live', username: 'live_admin', role: 'admin' });
    const token = await adminToken(payload);
    const { status } = await call(contentWrite, token);
    expect(status).toBe(200);
  });

  it('Authorization: Bearer 与 Cookie 同权（纯接口验证走的就是这条）', async () => {
    const payload = await seedAdmin({ sub: 'admin0000bear', username: 'bearer_admin', role: 'admin' });
    const token = await adminToken(payload);
    const res = await contentWrite(
      new Request('http://warm-journey.test/api/admin/anything', {
        headers: { authorization: `Bearer ${token}` },
      }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('env.DB 查询炸了不放行：active 回查失败 → 500', async () => {
    const payload = await seedAdmin({ sub: 'admin0000dberr', username: 'db_error_admin', role: 'admin' });
    const token = await adminToken(payload);
    const key = Symbol.for('__cloudflare-context__');
    const globalScope = globalThis as Record<symbol, unknown>;
    const saved = globalScope[key];
    // 只给 requireActiveAdmin 用到的两项：密钥仍在（JWT 验得过），D1 换成必然抛错的桩
    globalScope[key] = {
      env: {
        JWT_SECRET: env.JWT_SECRET,
        DB: { prepare: () => { throw new Error('D1 unavailable'); } },
      },
    };
    try {
      const { status, body } = await call(contentWrite, token);
      expect(status).toBe(500);
      expect(body.error).toBe('服务暂不可用');
    } finally {
      globalScope[key] = saved;
    }
  });
});

describe('withAdmin 的错误兜底口径', () => {
  it('handler 抛 Response：原样透传，不被压成 500', async () => {
    const route = withAdmin(async () => {
      throw new Response(JSON.stringify({ ok: false, error: '业务冲突' }), { status: 409 });
    });
    const payload = await seedAdmin({ sub: 'admin0000resp', username: 'throw_response', role: 'admin' });
    const res = await route(
      new Request('http://warm-journey.test/api/admin/anything', { headers: authHeaders(await adminToken(payload)) }),
      ctx,
    );
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('业务冲突');
  });

  it('handler 抛普通 Error → 500 且不泄漏内部文案', async () => {
    const route = withAdmin(async () => {
      throw new Error('SQLITE_INTERNAL_DETAIL');
    });
    const payload = await seedAdmin({ sub: 'admin0000boom', username: 'throw_error', role: 'admin' });
    const res = await route(
      new Request('http://warm-journey.test/api/admin/anything', { headers: authHeaders(await adminToken(payload)) }),
      ctx,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('SQLITE_INTERNAL_DETAIL');
  });
});
