// 4-2 · visit 状态机迁移表（对应 10-05 致命项 3.3 + 本次 L6 一次性码 / L7 评价窗口 / P2-20 过期闸门）
// 被测面是 src/lib/db 的 visit 写路径：状态迁移只能走条件 UPDATE，越格必须被拒。
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AUTO_CHECKOUT_AFTER, FEEDBACK_WINDOW, RESERVATION_TTL,
  cancelVisit, checkinVisit, checkoutVisit, createVisitFeedback, expireStaleVisits,
  getOccupancy, getRiderVisitState, getVisit, reserveVisit,
} from '@/lib/db';
import {
  RIDER_A, RIDER_B, applySchema, countVisits, env, nowUnix, readVisit,
  seedPoint, seedVisit, riderOf, setVisitState,
} from './_helpers';

const CODE = 'k9m2x7q4td';
const POINT = 'point0000sm01';
type FeedbackPayload = Parameters<typeof createVisitFeedback>[1];

beforeAll(async () => {
  await applySchema();
  await seedPoint({ id: POINT });
});

describe('完整生命周期：reserved → in_store → completed', () => {
  it('预约落库：状态 reserved、一次性码 10 位小写、created_ip 记账', async () => {
    const point = await seedPoint({ id: 'point0000lfc01' });
    const r = await reserveVisit(env.DB, point, RIDER_A, '10.0.0.1');
    expect(r.created).toBe(true);
    if (!r.visit) throw new Error('reserveVisit 未返回 visit');
    expect(r.visit.status).toBe('reserved');
    expect(r.visit.checkin_code).toMatch(/^[0-9a-z]{10}$/);
    const row = await readVisit(r.visit.id);
    expect(row?.created_ip).toBe('10.0.0.1');
  });

  it('错码不入店：bad_code 且状态不变', async () => {
    const id = await seedVisit({ id: 'visit00lf00001', code: CODE, pointId: await seedPoint({ id: 'point0000lfc02' }) });
    const bad = await checkinVisit(env.DB, id, 'wrongcode1');
    expect(bad.error).toBe('bad_code');
    expect((await readVisit(id))?.status).toBe('reserved');
  });

  it('对码入店成功后当场把一次性码置 NULL（L6：用完即废）', async () => {
    const point = await seedPoint({ id: 'point0000lfc03' });
    const id = await seedVisit({ id: 'visit00lf00002', code: CODE, pointId: point });
    const ok = await checkinVisit(env.DB, id, CODE);
    expect(ok.error).toBeUndefined();
    expect(ok.visit?.status).toBe('in_store');
    expect(ok.visit?.checked_in_at).toBeGreaterThan(0);
    expect((await readVisit(id))?.checkin_code).toBeNull();
  });

  it('码被消费后再扫：不再报 bad_code，交给状态机给 already', async () => {
    const point = await seedPoint({ id: 'point0000lfc04' });
    const id = await seedVisit({ id: 'visit00lf00003', status: 'in_store', code: null, pointId: point });
    const again = await checkinVisit(env.DB, id, '');
    expect(again.already).toBe(true);
    expect(again.error).toBeUndefined();
  });

  it('离店：completed 并写 checked_out_at；重复离店幂等返回 already', async () => {
    const point = await seedPoint({ id: 'point0000lfc05' });
    const id = await seedVisit({ id: 'visit00lf00004', status: 'in_store', code: null, pointId: point });
    const out = await checkoutVisit(env.DB, id);
    expect(out.visit?.status).toBe('completed');
    expect(out.visit?.checked_out_at).toBeGreaterThan(0);
    const again = await checkoutVisit(env.DB, id);
    // 口径：completed 再离店 = already（幂等成功）；route 把它翻成 200 + already:true，
    // 与计划草案里"再 checkout = invalid_state"不同，以现网代码语义为准。
    expect(again.already).toBe(true);
    expect(again.error).toBeUndefined();
  });

  it('已完成后再取消：invalid_state', async () => {
    const point = await seedPoint({ id: 'point0000lfc06' });
    const id = await seedVisit({
      id: 'visit00lf00005', status: 'completed', code: null, pointId: point,
    });
    const cancel = await cancelVisit(env.DB, id, await riderOf(id));
    expect(cancel.error).toBe('invalid_state');
  });
});

describe('迁移表：五种状态 × 三种动作逐格核对', () => {
  type Action = 'checkin' | 'checkout' | 'cancel';
  const cases: Array<{ status: 'reserved' | 'in_store' | 'completed' | 'cancelled' | 'expired'; action: Action; expect: 'ok' | 'already' | 'invalid' }> = [
    { status: 'reserved', action: 'checkin', expect: 'ok' },
    { status: 'in_store', action: 'checkin', expect: 'already' },
    { status: 'completed', action: 'checkin', expect: 'invalid' },
    { status: 'cancelled', action: 'checkin', expect: 'invalid' },
    { status: 'expired', action: 'checkin', expect: 'invalid' },
    { status: 'reserved', action: 'checkout', expect: 'invalid' },
    { status: 'in_store', action: 'checkout', expect: 'ok' },
    { status: 'completed', action: 'checkout', expect: 'already' },
    { status: 'cancelled', action: 'checkout', expect: 'invalid' },
    { status: 'expired', action: 'checkout', expect: 'invalid' },
    { status: 'reserved', action: 'cancel', expect: 'ok' },
    { status: 'in_store', action: 'cancel', expect: 'invalid' },
    { status: 'completed', action: 'cancel', expect: 'invalid' },
    { status: 'cancelled', action: 'cancel', expect: 'invalid' },
    { status: 'expired', action: 'cancel', expect: 'invalid' },
  ];

  for (const [i, c] of cases.entries()) {
    it(`${c.status} --${c.action}--> ${c.expect}`, async () => {
      const id = `visit00mt${String(i).padStart(4, '0')}`;
      // 每格一个独立骑手 + 独立点位：进行中状态的种子行不得互相撞部分唯一索引
      const rider = String(i).padStart(16, '0');
      const point = await seedPoint({ id: `point0000mt${String(i).padStart(2, '0')}` });
      await seedVisit({
        id,
        pointId: point,
        rider,
        status: c.status,
        code: c.status === 'reserved' ? CODE : null,
        checkedInAt: c.status === 'in_store' || c.status === 'completed' ? nowUnix() - 600 : null,
        checkedOutAt: c.status === 'completed' ? nowUnix() - 60 : null,
      });

      const result = c.action === 'checkin'
        ? await checkinVisit(env.DB, id, CODE)
        : c.action === 'checkout'
          ? await checkoutVisit(env.DB, id, rider)
          : await cancelVisit(env.DB, id, rider);

      if (c.expect === 'ok') {
        expect(result.error).toBeUndefined();
        expect(result.visit?.status).toBe(
          c.action === 'checkin' ? 'in_store' : c.action === 'checkout' ? 'completed' : 'cancelled',
        );
        // 入店即废码：只有 checkin 成功的格子会被置 NULL
        expect((await readVisit(id))?.checkin_code).toBe(c.action === 'checkin' ? null : CODE_MIRROR(c.status));
      } else if (c.expect === 'already') {
        expect('already' in result && result.already).toBe(true);
        expect(result.error).toBeUndefined();
        expect((await readVisit(id))?.status).toBe(c.status);
      } else {
        expect(result.error).toBe('invalid_state');
        expect((await readVisit(id))?.status).toBe(c.status);
      }
    });
  }

  // 只有 reserved 行的码还在（其余格子种子即 NULL）
  function CODE_MIRROR(status: string): string | null {
    return status === 'reserved' ? CODE : null;
  }

  it('凭证面：非本人的 checkout / cancel 一律 forbidden，不改动状态', async () => {
    const point = await seedPoint({ id: 'point0000own01' });
    const id = await seedVisit({ id: 'visit00mtnowner', status: 'in_store', code: null, pointId: point });
    const out = await checkoutVisit(env.DB, id, RIDER_B);
    expect(out.error).toBe('forbidden');
    const cancel = await cancelVisit(env.DB, id, RIDER_B);
    expect(cancel.error).toBe('forbidden');
    expect((await readVisit(id))?.status).toBe('in_store');
  });

  it('不存在的 id：三个动作都 not_found', async () => {
    expect((await checkinVisit(env.DB, 'nosuchvisit01', CODE)).error).toBe('not_found');
    expect((await checkoutVisit(env.DB, 'nosuchvisit01', RIDER_A)).error).toBe('not_found');
    expect((await cancelVisit(env.DB, 'nosuchvisit01', RIDER_A)).error).toBe('not_found');
  });

  it('reserved 态但码已丢失（异常数据）：不放行，按 bad_code 拒', async () => {
    const point = await seedPoint({ id: 'point0000nod01' });
    const id = await seedVisit({ id: 'visit00mtnocode', status: 'reserved', code: null, pointId: point });
    const r = await checkinVisit(env.DB, id, '');
    expect(r.error).toBe('bad_code');
    expect((await readVisit(id))?.status).toBe('reserved');
  });

  it('扫码串大小写/首尾空格不敏感', async () => {
    const point = await seedPoint({ id: 'point0000cse01' });
    const id = await seedVisit({ id: 'visit00mtcase', code: CODE, pointId: point });
    const r = await checkinVisit(env.DB, id, `  ${CODE.toUpperCase()} `);
    expect(r.error).toBeUndefined();
    expect(r.visit?.status).toBe('in_store');
  });
});

describe('过期闸门（P2-20）：超时预约不能被扫成已入店', () => {
  it('reserved_at 超过 TTL：对码 checkin 也是 invalid_state', async () => {
    const point = await seedPoint({ id: 'point0000exp01' });
    const id = await seedVisit({ id: 'visit00exp01', code: CODE, pointId: point });
    await setVisitState(id, { reserved_at: nowUnix() - RESERVATION_TTL - 120 });
    const r = await checkinVisit(env.DB, id, CODE);
    expect(r.error).toBe('invalid_state');
    expect((await readVisit(id))?.status).toBe('reserved'); // 写路径不跑懒清理，状态由读路径收
  });

  it('懒清理：超 TTL 的 reserved → expired；超 4h 的 in_store → completed 并补离店时刻', async () => {
    const point = await seedPoint({ id: 'point0000exp02' });
    const stale = await seedVisit({ id: 'visit00exp02', code: CODE, pointId: point });
    await setVisitState(stale, { reserved_at: nowUnix() - RESERVATION_TTL - 10 });
    const overstayed = await seedVisit({
      id: 'visit00exp03', pointId: point, status: 'in_store', code: null,
      checkedInAt: nowUnix() - AUTO_CHECKOUT_AFTER - 10,
    });
    await expireStaleVisits(env.DB);
    expect((await readVisit(stale))?.status).toBe('expired');
    const done = await readVisit(overstayed);
    expect(done?.status).toBe('completed');
    expect(done?.checked_out_at).toBe((done?.checked_in_at as number) + AUTO_CHECKOUT_AFTER);
  });

  it('未超时的记录不受懒清理影响', async () => {
    const point = await seedPoint({ id: 'point0000exp03' });
    const fresh = await seedVisit({ id: 'visit00exp04', code: CODE, pointId: point });
    await expireStaleVisits(env.DB);
    expect((await readVisit(fresh))?.status).toBe('reserved');
  });

  it('占用数字必须先过懒清理（过期预约不得继续占位）', async () => {
    const point = await seedPoint({ id: 'point0000occ01', capacity: 5 });
    const stale = await seedVisit({ id: 'visit00exp05', pointId: point, code: CODE });
    await seedVisit({ id: 'visit00exp06', pointId: point, rider: RIDER_B, status: 'in_store', code: null });
    await setVisitState(stale, { reserved_at: nowUnix() - RESERVATION_TTL - 5 });
    expect(await getOccupancy(env.DB, point)).toEqual({ in_store: 1, reserved: 0, capacity: 5 });
  });

  it('getRiderVisitState 只认进行中状态，并按 token 过滤', async () => {
    const state = await getRiderVisitState(env.DB, 'point0000occ01', RIDER_B);
    expect(state.visit?.id).toBe('visit00exp06');
    expect(state.visit?.status).toBe('in_store');
    expect(state.visit?.checkin_code).toBeNull();   // L6：in_store 期间不再有码
    const other = await getRiderVisitState(env.DB, 'point0000occ01', RIDER_A);
    expect(other.visit).toBeNull();
  });
});

describe('评价窗口（L7 / 决策 D4）', () => {
  const feedback = (visit_id: string, rider_token: string, over: Partial<FeedbackPayload> = {}) =>
    createVisitFeedback(env.DB, {
      visit_id, rider_token, rating: 5, supports: ['充电', '饮用水'], suggestion: '很好', ...over,
    });

  // 评价必须是本人：种子行统一用 RIDER_A，点位各不相同避免进行中索引冲突
  async function seedCompleted(label: string, daysAgo: number | null, id: string) {
    const point = await seedPoint({ id: `point0000${label}` });
    const now = nowUnix();
    const out = daysAgo === null ? now - 60 : now - daysAgo * 86400;
    await seedVisit({
      id, pointId: point, rider: RIDER_A, status: 'completed', code: null,
      checkedInAt: out - 3600, checkedOutAt: out,
    });
    return id;
  }

  it('离店 7 天内可评，一人一条：重复提交 duplicate', async () => {
    const id = await seedCompleted('fb0001', null, 'visit00fb0001');
    const first = await feedback(id, RIDER_A);
    expect(first.error).toBeUndefined();
    expect(first.id).toBeTruthy();
    expect((await feedback(id, RIDER_A)).error).toBe('duplicate');
  });

  it('离店超过 7 天 → expired（近期口碑不得被历史 visit 稀释）', async () => {
    const id = await seedCompleted('fb0002', 8, 'visit00fb0002');
    expect((await feedback(id, RIDER_A)).error).toBe('expired');
  });

  it('窗口边界：6 天 23 小时仍可评', async () => {
    const id = await seedCompleted('fb0003', 6, 'visit00fb0003');
    expect((await feedback(id, RIDER_A)).error).toBeUndefined();
  });

  it('completed 但没有离店时刻（异常数据）：不给无限窗口 → expired', async () => {
    const point = await seedPoint({ id: 'point0000fb0004' });
    const id = await seedVisit({
      id: 'visit00fb0004', pointId: point, rider: RIDER_A, status: 'completed', code: null, checkedOutAt: null,
    });
    expect((await feedback(id, RIDER_A)).error).toBe('expired');
  });

  it('未离店不能评：in_store / reserved 都 invalid_state', async () => {
    const p1 = await seedPoint({ id: 'point0000fb0005' });
    const inStore = await seedVisit({
      id: 'visit00fb0005', pointId: p1, rider: RIDER_A, status: 'in_store', code: null,
    });
    expect((await feedback(inStore, RIDER_A)).error).toBe('invalid_state');
    const p2 = await seedPoint({ id: 'point0000fb0006' });
    const reserved = await seedVisit({ id: 'visit00fb0006', pointId: p2, rider: RIDER_A, code: CODE });
    expect((await feedback(reserved, RIDER_A)).error).toBe('invalid_state');
  });

  it('冒名评价：rider_token 不匹配 → forbidden', async () => {
    const id = await seedCompleted('fb0007', null, 'visit00fb0007');
    expect((await feedback(id, RIDER_B)).error).toBe('forbidden');
  });

  it('point_id 由 visit 反查：客户端即使塞别的点位也进不了库', async () => {
    const id = await seedCompleted('fb0008', null, 'visit00fb0008');
    const decoy = await seedPoint({ id: 'point0000fb0009' });
    const r = await createVisitFeedback(env.DB, {
      visit_id: id, rider_token: RIDER_A, rating: 5, supports: ['充电'], suggestion: '',
      point_id: decoy,
    } as FeedbackPayload);
    expect(r.error).toBeUndefined();
    const row = await env.DB.prepare('SELECT point_id FROM visit_feedback WHERE visit_id = ?')
      .bind(id).first<{ point_id: string }>();
    expect(row?.point_id).toBe('point0000fb0008');
  });

  it('白名单外的 supports 标签不落库（防任意字符串进 AI prompt）', async () => {
    const id = await seedCompleted('fb0010', null, 'visit00fb0010');
    const r = await feedback(id, RIDER_A, { supports: ['充电', '<script>投毒</script>', '热饭'] });
    expect(r.error).toBeUndefined();
    const row = await env.DB.prepare('SELECT supports FROM visit_feedback WHERE visit_id = ?')
      .bind(id).first<{ supports: string }>();
    expect(JSON.parse(row?.supports ?? '[]')).toEqual(['充电', '热饭']);
  });

  it('未知 visit → not_found', async () => {
    expect((await feedback('nosuchvisit02', RIDER_A)).error).toBe('not_found');
  });
});

describe('读出口形状', () => {
  it('getVisit 带出 point_name（详情页卡片标题用）', async () => {
    const id = await seedVisit({ id: 'visit00sm0099', code: CODE, pointId: POINT });
    const v = await getVisit(env.DB, id);
    expect(v?.point_name).toBe('测试驿站');
    expect(v?.status).toBe('reserved');
  });

  it('同一点位同一骑手重复预约幂等：返回同一条进行中记录', async () => {
    const point = await seedPoint({ id: 'point0000idmp1' });
    const first = await reserveVisit(env.DB, point, RIDER_A);
    const second = await reserveVisit(env.DB, point, RIDER_A);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.visit?.id).toBe(first.visit?.id);
    expect(await countVisits(point, ['reserved', 'in_store'])).toBe(1);
  });
});
