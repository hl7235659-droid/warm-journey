// 4-4 · visit 出口的脱敏口径（锁定批次 1-3 的 M1/M5 收口，防新增端点再犯）
// 纯函数口径已在 scripts/tests/visit-sanitize.test.mjs 锁死；这里锁的是"真路由真响应"：
// 五个 visit 出口逐个调用，断言响应体里拿不到 rider_token / created_ip / checkin_code 的原值。
import { beforeAll, describe, expect, it } from 'vitest';

import { POST as activePost } from '@/app/api/visits/active/route';
import { GET as visitGet } from '@/app/api/visits/[id]/route';
import { POST as cancelPost } from '@/app/api/visits/[id]/cancel/route';
import { POST as checkinPost } from '@/app/api/visits/[id]/checkin/route';
import { POST as checkoutPost } from '@/app/api/visits/[id]/checkout/route';
import {
  RIDER_A, RIDER_B, applySchema, installCloudflareContext, riderOf, seedPoint, seedVisit,
  type SeedVisitOptions,
} from './_helpers';

const CODE = 'vtcode0123';
const IP = '203.0.113.9';
const POINT = 'point0000ep01';
const INTERNAL = ['rider_token', 'created_ip', 'checkin_code'] as const;

type Ctx = { params: Promise<{ id: string }> };
const ctxOf = (id: string): Ctx => ({ params: Promise.resolve({ id }) });

async function json(res: Response) {
  return await res.json() as {
    ok: boolean; error?: string;
    data?: { visit?: Record<string, unknown> | null; occupancy?: Record<string, unknown>; already?: boolean };
  };
}

const post = (path: string, body: unknown) => new Request(`http://warm-journey.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// 一个出口只测一条 visit：把该行真实的 rider_token 取回来，才能断言"原值没出现在响应里"
async function seed(label: string, over: Partial<SeedVisitOptions> = {}) {
  const id = `visit00${label}`;
  await seedVisit({ id, pointId: POINT, code: CODE, ip: IP, ...over });
  return { id, rider: await riderOf(id) };
}

// 断言：响应 JSON 里既没有这三个键（除白名单），也拼不出任何一条原值
function expectNoLeak(text: string, rider: string, label: string, allowCode = false) {
  expect(text, label).not.toContain(rider);
  expect(text, label).not.toContain(IP);
  if (!allowCode) expect(text, label).not.toContain(CODE);
}

beforeAll(async () => {
  installCloudflareContext();
  await applySchema();
  await seedPoint({ id: POINT });
});

describe('GET /api/visits/[id]（入店确认页，id 即凭证）', () => {
  it('rider_token 只给前 6 位，入店码与 IP 一律不下发', async () => {
    const { id, rider } = await seed('ep0001');
    const res = await visitGet(new Request(`http://warm-journey.test/api/visits/${id}`), ctxOf(id));
    expect(res.status).toBe(200);
    const text = await res.text();                 // 只读一次：clone() 在被 json() 消费后会失败
    const body = JSON.parse(text) as Awaited<ReturnType<typeof json>>;
    const visit = body.data?.visit as Record<string, unknown>;
    expect(visit.rider_token).toBe(`${rider.slice(0, 6)}…`);
    expect('checkin_code' in visit).toBe(false);
    expect('created_ip' in visit).toBe(false);
    expect(visit.status).toBe('reserved');
    expect(visit.point_name).toBe('测试驿站');
    expectNoLeak(text, rider, 'GET /api/visits/[id]');
  });

  it('不存在的 id → 404，响应不泄漏任何 visit 行', async () => {
    const res = await visitGet(new Request('http://warm-journey.test/api/visits/nosuchvisit'), ctxOf('nosuchvisit'));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(CODE);
  });
});

describe('POST /api/visits/[id]/checkin（店员扫码确认）', () => {
  it('入店成功：响应无三字段，一次性码已随 L6 置 NULL', async () => {
    const { id, rider } = await seed('ep0002');
    const res = await checkinPost(post('/api/visits/x/checkin', { code: CODE }), ctxOf(id));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data?.visit?.status).toBe('in_store');
    expect(body.data?.already).toBe(false);
    const visit = body.data?.visit as Record<string, unknown>;
    for (const key of INTERNAL) expect(key in visit, key).toBe(false);
    expectNoLeak(JSON.stringify(body), rider, 'checkin');
  });

  it('错码 → 403 且不回带 visit 对象', async () => {
    const { id, rider } = await seed('ep0003');
    const res = await checkinPost(post('/api/visits/x/checkin', { code: 'badcode111' }), ctxOf(id));
    expect(res.status).toBe(403);
    expectNoLeak(await res.text(), rider, 'checkin/bad_code');
  });

  it('zod 校验错误保持 422 原语义（L1：不再被压成"缺少入店码"的 403）', async () => {
    const { id } = await seed('ep0004');
    const res = await checkinPost(post('/api/visits/x/checkin', { code: '短' }), ctxOf(id));
    expect(res.status).toBe(422);
  });

  it('非法 JSON 体 → 400', async () => {
    const res = await checkinPost(
      new Request('http://warm-journey.test/api/visits/x/checkin', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{坏',
      }),
      ctxOf('visit00ep0004'),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/visits/[id]/checkout 与 /cancel', () => {
  it('离店成功：响应无三字段', async () => {
    const { id, rider } = await seed('ep0005', { status: 'in_store', code: null });
    const res = await checkoutPost(post('/api/visits/x/checkout', { rider_token: rider }), ctxOf(id));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data?.visit?.status).toBe('completed');
    expectNoLeak(JSON.stringify(body), rider, 'checkout');
  });

  it('非本人离店 → 403 且不泄漏当事人 token', async () => {
    const { id, rider } = await seed('ep0006', { status: 'in_store', code: null });
    const res = await checkoutPost(post('/api/visits/x/checkout', { rider_token: RIDER_B }), ctxOf(id));
    expect(res.status).toBe(403);
    expectNoLeak(await res.text(), rider, 'checkout/forbidden');
  });

  it('取消成功：响应无三字段', async () => {
    const { id, rider } = await seed('ep0007');
    const res = await cancelPost(post('/api/visits/x/cancel', { rider_token: rider }), ctxOf(id));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data?.visit?.status).toBe('cancelled');
    expectNoLeak(JSON.stringify(body), rider, 'cancel');
  });

  it('非法 rider_token 形态在 zod 层被拦（422），不进 DB', async () => {
    const res = await cancelPost(post('/api/visits/x/cancel', { rider_token: '短' }), ctxOf('visit00ep0007'));
    expect(res.status).toBe(422);
  });
});

describe('POST /api/visits/active（详情页卡片轮询）', () => {
  it('reserved 态：保留 checkin_code 供二维码渲染（决策 D5），token 与 IP 仍剥离', async () => {
    const point = await seedPoint({ id: 'point0000ep05' });
    const { id, rider } = await seed('ep0008', { pointId: point });
    const res = await activePost(post('/api/visits/active', { point_id: point, rider_token: rider }));
    expect(res.status).toBe(200);
    const body = await json(res);
    const visit = body.data?.visit as Record<string, unknown>;
    expect(visit.id).toBe(id);
    expect(visit.checkin_code).toBe(CODE);            // VisitCard 的二维码就靠它
    expect('rider_token' in visit).toBe(false);
    expect('created_ip' in visit).toBe(false);
    expect(body.data?.occupancy).toEqual({ in_store: 0, reserved: 1, capacity: null });
    expectNoLeak(JSON.stringify(body), rider, 'active', true);
  });

  it('in_store 态：码已被消费，响应里干脆没有这个键（前端走兜底分支）', async () => {
    const point = await seedPoint({ id: 'point0000ep06' });
    const { id, rider } = await seed('ep0009', { pointId: point, status: 'in_store', code: null });
    const res = await activePost(post('/api/visits/active', { point_id: point, rider_token: rider }));
    const body = await json(res);
    const visit = body.data?.visit as Record<string, unknown>;
    expect(visit.id).toBe(id);
    expect(visit.status).toBe('in_store');
    expect('checkin_code' in visit).toBe(false);
    expectNoLeak(JSON.stringify(body), rider, 'active/in_store');
  });

  it('没有进行中预约：visit 为 null 而不是缺键，占用数字照常返回', async () => {
    const point = await seedPoint({ id: 'point0000ep07' });
    const res = await activePost(post('/api/visits/active', { point_id: point, rider_token: RIDER_A }));
    const body = await json(res);
    expect(body.data?.visit).toBeNull();
    expect(body.data?.occupancy).toEqual({ in_store: 0, reserved: 0, capacity: null });
  });
});
