// 4-4 补充 · 本批次新收口的两个 visit 出口（原 M1/M5 收口表漏掉的第六、第七个口）
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { POST as reservePost } from '@/app/api/points/[id]/reserve/route';
import { PUT as adminVisitPut } from '@/app/api/admin/visits/[id]/route';
import {
  RIDER_A, RIDER_B, adminToken, applySchema, installCloudflareContext, riderOf,
  seedAdmin, seedPoint, seedVisit,
} from './_helpers';

const IP = '203.0.113.44';
type Ctx = { params: Promise<{ id: string }> };
const ctxOf = (id: string): Ctx => ({ params: Promise.resolve({ id }) });

// 带上 cf-connecting-ip：让库里真的记到这个 IP，"响应里不含它"才是有效断言
// （getClientIp 只认这个头，见 src/lib/http.ts）
const reserveReq = (body: unknown) => new Request('http://warm-journey.test/api/points/x/reserve', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  installCloudflareContext();
  await applySchema();
});

describe('POST /api/points/[id]/reserve（本人创建，D5 同口径）', () => {
  it('201：保留 checkin_code 给二维码，但不再回带完整 rider_token 与 created_ip', async () => {
    const point = await seedPoint({ id: 'point0000rv001' });
    const res = await reservePost(reserveReq({ rider_token: RIDER_A }), ctxOf(point));
    expect(res.status).toBe(201);
    const text = await res.text();
    const body = JSON.parse(text) as { ok: boolean; data: { visit: Record<string, unknown>; created: boolean } };
    const visit = body.data.visit;
    expect(visit.status).toBe('reserved');
    expect(visit.checkin_code).toMatch(/^[0-9a-z]{10}$/);   // VisitCard:65 的入店二维码靠它
    expect('rider_token' in visit).toBe(false);
    expect('created_ip' in visit).toBe(false);
    expect(text).not.toContain(RIDER_A);
    expect(text).not.toContain(IP);
    expect(body.data.created).toBe(true);
    // 库里确实记着这个 IP —— "响应里没有"才是真被剥掉，而不是恰好没写进去
    const row = await env.DB.prepare('SELECT created_ip FROM visits WHERE id = ?')
      .bind(visit.id as string).first<{ created_ip: string }>();
    expect(row?.created_ip).toBe(IP);
  });

  it('幂等再点：200 + created:false + 同一条记录，口径与首次一致', async () => {
    const point = await seedPoint({ id: 'point0000rv002' });
    const first = await reservePost(reserveReq({ rider_token: RIDER_A }), ctxOf(point));
    const firstBody = await first.json() as { data: { visit: { id: string } } };
    const again = await reservePost(reserveReq({ rider_token: RIDER_A }), ctxOf(point));
    expect(again.status).toBe(200);
    const againBody = await again.json() as { data: { visit: Record<string, unknown>; created: boolean } };
    expect(againBody.data.created).toBe(false);
    expect(againBody.data.visit.id).toBe(firstBody.data.visit.id);
    expect('rider_token' in againBody.data.visit).toBe(false);
  });

  it('S2 回归：temp_closed 点位 409 且文案区分"临时关闭/已关闭"', async () => {
    const temp = await seedPoint({ id: 'point0000rv003', status: 'temp_closed' });
    const closed = await seedPoint({ id: 'point0000rv004', status: 'closed' });
    const r1 = await reservePost(reserveReq({ rider_token: RIDER_A }), ctxOf(temp));
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { error: string }).error).toBe('该站点临时关闭，暂停预约');
    const r2 = await reservePost(reserveReq({ rider_token: RIDER_B }), ctxOf(closed));
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { error: string }).error).toBe('该站点已关闭，无法预约');
  });

  it('非 hex 形态的 rider_token 在 zod 层被拦（422）', async () => {
    const point = await seedPoint({ id: 'point0000rv005' });
    const res = await reservePost(reserveReq({ rider_token: 'NOT-HEX-TOKEN' }), ctxOf(point));
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/admin/visits/[id]（管理端强制离店）', () => {
  const adminReq = (token: string) => new Request('http://warm-journey.test/api/admin/visits/x', {
    method: 'PUT', headers: { cookie: `__Host-wj_admin=${token}` },
  });

  it('骑手标识只给前 6 位，与管理端列表同口径；入店码与 IP 不下发', async () => {
    const admin = await seedAdmin({ sub: 'admin0000fc01', username: 'force_checkout_admin', role: 'admin' });
    const token = await adminToken(admin);
    const point = await seedPoint({ id: 'point0000fc001' });
    const id = await seedVisit({ id: 'visit00fc0001', pointId: point, status: 'in_store', code: null, ip: IP });
    const rider = await riderOf(id);

    const res = await adminVisitPut(adminReq(token), ctxOf(id));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as { data: { visit: Record<string, unknown> } };
    const visit = body.data.visit;
    expect(visit.status).toBe('completed');
    expect(visit.rider_token).toBe(`${rider.slice(0, 6)}…`);
    expect('created_ip' in visit).toBe(false);
    expect('checkin_code' in visit).toBe(false);
    expect(text).not.toContain(rider);
  });

  it('未登录 401；inspector 越权 403（写路由 roles=ROLES_CONTENT + active）', async () => {
    const point = await seedPoint({ id: 'point0000fc002' });
    const id = await seedVisit({ id: 'visit00fc0002', pointId: point, status: 'in_store', code: null });
    const anon = await adminVisitPut(new Request('http://warm-journey.test/api/admin/visits/x', { method: 'PUT' }), ctxOf(id));
    expect(anon.status).toBe(401);

    const inspector = await seedAdmin({ sub: 'admin0000fc02', username: 'inspector_fc', role: 'inspector' });
    const denied = await adminVisitPut(adminReq(await adminToken(inspector)), ctxOf(id));
    expect(denied.status).toBe(403);
  });
});
