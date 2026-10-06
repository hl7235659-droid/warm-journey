// 4-3 · 容量与并发（对应 10-05 致命项 3.1「名额超卖」+ 本次同 IP 占位闸门）
// 这里跑的是真实 D1：reserveVisit 把"数名额 + 插入"合并成一条 INSERT ... SELECT，
// 用例要证明的正是并发窗口内不会超卖、也不会把过期名额算进去。
import { beforeAll, describe, expect, it } from 'vitest';

import { MAX_ACTIVE_RESERVES_PER_IP, RESERVATION_TTL, cancelVisit, getOccupancy, reserveVisit } from '@/lib/db';
import { applySchema, env, nowUnix, readVisit, seedPoint, seedVisit } from './_helpers';

const riderAt = (n: number) => String(n).padStart(16, '0');

beforeAll(async () => {
  await applySchema();
});

async function activeCount(pointId: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM visits WHERE point_id = ? AND status IN ('reserved','in_store')`)
    .bind(pointId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('容量闸门', () => {
  it('capacity=1：两个骑手并发预约，恰一个成功、另一个 full，库里只有一条', async () => {
    const point = await seedPoint({ id: 'point0000cap01', capacity: 1 });
    const [a, b] = await Promise.all([
      reserveVisit(env.DB, point, riderAt(1)),
      reserveVisit(env.DB, point, riderAt(2)),
    ]);
    const created = [a.created, b.created].filter(Boolean).length;
    expect(created).toBe(1);
    const failed = [a, b].find((r) => !r.created);
    expect(failed && 'full' in failed && failed.full).toBe(true);
    expect(await activeCount(point)).toBe(1);
  });

  it('capacity=2：三个骑手并发预约 → 两成功一满', async () => {
    const point = await seedPoint({ id: 'point0000cap02', capacity: 2 });
    const results = await Promise.all([1, 2, 3].map((n) => reserveVisit(env.DB, point, riderAt(100 + n))));
    expect(results.filter((r) => r.created).length).toBe(2);
    expect(results.filter((r) => 'full' in r && r.full).length).toBe(1);
    expect(await activeCount(point)).toBe(2);
  });

  it('已在店同样占名额：capacity=1 且有一条 in_store 时新预约 full', async () => {
    const point = await seedPoint({ id: 'point0000cap03', capacity: 1 });
    await seedVisit({ id: 'visit00cap003', pointId: point, rider: riderAt(3), status: 'in_store', code: null });
    const r = await reserveVisit(env.DB, point, riderAt(4));
    expect('full' in r && r.full).toBe(true);
    expect(await activeCount(point)).toBe(1);
  });

  it('没配 capacity 的点位不设上限（历史点位不得被当成 0 名额）', async () => {
    const point = await seedPoint({ id: 'point0000cap04' });
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => reserveVisit(env.DB, point, riderAt(200 + n))));
    expect(results.every((r) => r.created)).toBe(true);
    const occ = await getOccupancy(env.DB, point);
    expect(occ.capacity).toBeNull();
    expect(occ.reserved).toBe(5);
  });

  it('admission 是坏 JSON：json_valid 兜底成"无上限"，而不是打穿成 500', async () => {
    const point = await seedPoint({ id: 'point0000cap05', capacity: 1 });
    await env.DB.prepare(`UPDATE service_points SET admission = '{坏数据' WHERE id = ?`).bind(point).run();
    const r = await reserveVisit(env.DB, point, riderAt(5));
    expect(r.created).toBe(true);
  });

  it('取消后名额立即释放', async () => {
    const point = await seedPoint({ id: 'point0000cap06', capacity: 1 });
    const first = await reserveVisit(env.DB, point, riderAt(6));
    if (!first.visit) throw new Error('首次预约应成功');
    await env.DB.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).bind(first.visit.id).run();
    const second = await reserveVisit(env.DB, point, riderAt(7));
    expect(second.created).toBe(true);
    expect(await activeCount(point)).toBe(1);
  });

  it('过期预约不占名额：预约超 TTL 后新骑手可直接接管，老行被懒清理置 expired', async () => {
    const point = await seedPoint({ id: 'point0000cap07', capacity: 1 });
    const stale = await seedVisit({
      id: 'visit00cap070', pointId: point, rider: riderAt(8), code: 'zzzzzzzzzz',
      reservedAt: nowUnix() - RESERVATION_TTL - 30,
    });
    const r = await reserveVisit(env.DB, point, riderAt(9));
    expect(r.created).toBe(true);
    expect((await readVisit(stale))?.status).toBe('expired');
  });
});

describe('并发重复预约（部分唯一索引 idx_visits_active_rider）', () => {
  it('同一骑手双击并发：只落一条，两次都拿到同一条记录', async () => {
    const point = await seedPoint({ id: 'point0000dup01', capacity: 5 });
    const [a, b] = await Promise.all([
      reserveVisit(env.DB, point, riderAt(11)),
      reserveVisit(env.DB, point, riderAt(11)),
    ]);
    expect(await activeCount(point)).toBe(1);
    expect(a.visit?.id).toBe(b.visit?.id);
    const createdCount = [a.created, b.created].filter(Boolean).length;
    expect(createdCount).toBe(1);
  });

  it('同一骑手不同点位各自一条：索引只在同点位内生效', async () => {
    const p1 = await seedPoint({ id: 'point0000dup02' });
    const p2 = await seedPoint({ id: 'point0000dup03' });
    const r1 = await reserveVisit(env.DB, p1, riderAt(12));
    const r2 = await reserveVisit(env.DB, p2, riderAt(12));
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
  });
});

describe('同 IP 活跃预约上限（脚本批量占位）', () => {
  it(`达到 MAX_ACTIVE_RESERVES_PER_IP=${MAX_ACTIVE_RESERVES_PER_IP} 后新预约被拒`, async () => {
    const point = await seedPoint({ id: 'point0000ipl01' });
    for (let n = 0; n < MAX_ACTIVE_RESERVES_PER_IP; n++) {
      await seedVisit({
        id: `visit00ipl${String(n).padStart(3, '0')}`,
        pointId: point,
        rider: riderAt(300 + n),
        ip: '203.0.113.7',
        code: 'aaaaaaaaaa',
      });
    }
    const blocked = await reserveVisit(env.DB, point, riderAt(999), '203.0.113.7');
    expect('ipLimited' in blocked && blocked.ipLimited).toBe(true);
    expect(blocked.created).toBe(false);
  });

  it('换 IP 不受影响；历史（已离店）预约不占额度', async () => {
    const point = await seedPoint({ id: 'point0000ipl02' });
    const ok = await reserveVisit(env.DB, point, riderAt(13), '198.51.100.1');
    expect(ok.created).toBe(true);
    if (!ok.visit) throw new Error('前置预约应成功');
    await cancelVisit(env.DB, ok.visit.id, riderAt(13));
    const again = await reserveVisit(env.DB, point, riderAt(14), '198.51.100.1');
    expect(again.created).toBe(true);
  });

  it('不传 IP（内部调用）不触发该闸门', async () => {
    const point = await seedPoint({ id: 'point0000ipl03' });
    const r = await reserveVisit(env.DB, point, riderAt(15));
    expect(r.created).toBe(true);
  });
});
