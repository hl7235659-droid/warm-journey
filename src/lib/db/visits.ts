import type { Visit } from '@/lib/types';
import { genId, genRandomCode, paginate, unixNow } from './helpers';

// ---------------------------------------------------------------------------
// Visits（预约进店 / 扫码离店 / 在店人数）
// ---------------------------------------------------------------------------

// 预约名额保留时长：2 小时
export const RESERVATION_TTL = 2 * 3600;
// 入店超过该时长未扫码离店 → 自动离店，防止人数虚高
export const AUTO_CHECKOUT_AFTER = 4 * 3600;

// 懒清理：超时 reserved → expired；超时在店 → 自动 completed。
// 只在**读路径**跑（getOccupancy / getRiderVisitState / getNearbyPoints / 管理端
// listVisits / getAdminStats / reserveVisit 的容量闸门）——写路径每次白跑两条全表 UPDATE，
// 而过期数据真正的危害是让这些数字虚高、被展示给用户。
// 另被 src/worker.ts 的 scheduled（Cron）handler 复用作低流量时段的兜底。
export async function expireStaleVisits(db: D1Database) {
  const now = unixNow();
  await db.prepare(
    `UPDATE visits SET status = 'expired' WHERE status = 'reserved' AND reserved_at < ?`,
  ).bind(now - RESERVATION_TTL).run();
  await db.prepare(
    `UPDATE visits SET status = 'completed', checked_out_at = checked_in_at + ?
     WHERE status = 'in_store' AND checked_in_at < ?`,
  ).bind(AUTO_CHECKOUT_AFTER, now - AUTO_CHECKOUT_AFTER).run();
}

export interface Occupancy {
  in_store: number;      // 当前在店人数
  reserved: number;      // 有效预约（未到店）
  capacity: number | null;
}

async function occupancyFor(db: D1Database, pointId: string): Promise<Occupancy> {
  const [inStore, reserved, point] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM visits WHERE point_id = ? AND status = 'in_store'`)
      .bind(pointId).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM visits WHERE point_id = ? AND status = 'reserved'`)
      .bind(pointId).first<{ n: number }>(),
    db.prepare('SELECT admission FROM service_points WHERE id = ?')
      .bind(pointId).first<{ admission: string }>(),
  ]);
  let capacity: number | null = null;
  try {
    const adm = JSON.parse(point?.admission ?? '{}') as { capacity?: number };
    capacity = adm.capacity ?? null;
  } catch { /* 忽略坏数据 */ }
  return { in_store: inStore?.n ?? 0, reserved: reserved?.n ?? 0, capacity };
}

// 占用数字是"过期预约也算人在"的高发区，先跑懒清理再统计（见 expireStaleVisits）
export async function getOccupancy(db: D1Database, pointId: string): Promise<Occupancy> {
  await expireStaleVisits(db);
  return occupancyFor(db, pointId);
}

// 同一 IP 在 24 小时内允许的新增预约数：拦脚本批量占位，
// 同时避免宿舍/基站共享出口 IP 的历史活跃预约把正常骑手永久挡在门外
export const MAX_ACTIVE_RESERVES_PER_IP = 10;

// 预约：同一点位同一骑手有进行中 visit 则直接返回它（幂等）；
// 容量校验与插入合并为单条 INSERT ... SELECT 原子完成，并发下不会超卖；
// 部分唯一索引 (point_id, rider_token) WHERE status IN ('reserved','in_store') 兜底重复预约。
export async function reserveVisit(
  db: D1Database,
  pointId: string,
  riderToken: string,
  ip = '',
) {
  // 容量闸门本身就是占用统计，先清过期，否则过期预约会虚占名额
  await expireStaleVisits(db);
  const existing = await db.prepare(
    `SELECT * FROM visits WHERE point_id = ? AND rider_token = ? AND status IN ('reserved','in_store')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(pointId, riderToken).first<Visit>();
  if (existing) return { visit: existing, created: false as const };

  if (ip) {
    const mine = await db.prepare(
      `SELECT COUNT(*) as n FROM visits
       WHERE created_ip = ? AND status IN ('reserved','in_store') AND created_at >= ?`,
    ).bind(ip, unixNow() - 86400).first<{ n: number }>();
    if ((mine?.n ?? 0) >= MAX_ACTIVE_RESERVES_PER_IP) {
      return { visit: null, created: false as const, ipLimited: true as const };
    }
  }

  const id = genId();
  const now = unixNow();
  const checkinCode = genRandomCode();
  try {
    // json_valid 兜底：admission 若是历史脏数据（非法 JSON），json_extract 会直接报错打穿到 500
    const r = await db.prepare(
      `INSERT INTO visits (id, point_id, rider_token, created_ip, checkin_code, status, reserved_at, created_at)
       SELECT ?, ?, ?, ?, ?, 'reserved', ?, ?
       WHERE (
         SELECT COUNT(*) FROM visits
         WHERE point_id = ? AND status IN ('reserved','in_store')
       ) < COALESCE((
         SELECT CASE WHEN json_valid(admission)
                     THEN CAST(json_extract(admission, '$.capacity') AS INTEGER) END
         FROM service_points WHERE id = ?
       ), 9223372036854775807)`,
    ).bind(id, pointId, riderToken, ip || null, checkinCode, now, now, pointId, pointId).run();
    if ((r.meta.changes ?? 0) === 0) {
      return { visit: null, created: false as const, full: true as const };
    }
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? '';
    if (msg.includes('UNIQUE')) {
      // 并发下同一骑手重复预约 → 幂等返回已有 visit
      const dup = await db.prepare(
        `SELECT * FROM visits WHERE point_id = ? AND rider_token = ? AND status IN ('reserved','in_store')
         ORDER BY created_at DESC LIMIT 1`,
      ).bind(pointId, riderToken).first<Visit>();
      if (dup) return { visit: dup, created: false as const };
    }
    throw e;
  }
  const visit = await getVisit(db, id);
  return { visit, created: true as const };
}

export async function getVisit(db: D1Database, id: string) {
  return db.prepare(
    `SELECT v.*, sp.name as point_name FROM visits v
     LEFT JOIN service_points sp ON sp.id = v.point_id WHERE v.id = ?`,
  ).bind(id).first<Visit>();
}

// 骑手在某点位的进行中 visit + 该点位实时占用（详情页 VisitCard 刷新用）。
// 合并成一个函数是因为这两份数据必须同一时刻取：拆成 getActiveVisit + getOccupancy
// 会让 expireStaleVisits 在一个请求里白跑两遍。
export async function getRiderVisitState(db: D1Database, pointId: string, riderToken: string) {
  await expireStaleVisits(db);
  const [visit, occupancy] = await Promise.all([
    db.prepare(
      `SELECT * FROM visits WHERE point_id = ? AND rider_token = ? AND status IN ('reserved','in_store')
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(pointId, riderToken).first<Visit>(),
    occupancyFor(db, pointId),
  ]);
  return { visit, occupancy };
}

// 入店确认：必须携带二维码里的一次性入店码，仅凭 visit id 无法远程确认
export async function checkinVisit(db: D1Database, id: string, code = '') {
  const visit = await getVisit(db, id);
  if (!visit) return { error: 'not_found' as const };
  const expected = visit.checkin_code ?? '';
  // 入店成功即把 checkin_code 置 NULL（见下面的条件 UPDATE），所以"码为空"= 这张码已被消费。
  // 已被消费的码不再当 bad_code 报错，交给下面的状态机给出 already / invalid_state，
  // 与"重复扫码"的原本语义一致；但 reserved 态必须凭码，异常数据（无码预约）不放行。
  const consumed = !expected;
  if (!consumed && expected !== code.trim().toLowerCase()) {
    return { error: 'bad_code' as const, visit };
  }
  if (visit.status === 'in_store') return { visit, already: true as const };
  if (visit.status !== 'reserved') return { error: 'invalid_state' as const, visit };
  if (consumed) return { error: 'bad_code' as const, visit };
  // 条件 UPDATE 保证状态机安全迁移：并发 cancel/checkin 只有一个能成功。
  // reserved_at 谓词 = 预约 TTL：确认入店不在写路径跑 expireStaleVisits（P2-20），
  // 这里自带闸门，否则两小时前占位没到的预约会被扫成"已入店"，名额也被他占着。
  // checkin_code 同条语句置 NULL：一次性码用完即废，in_store 期间不再被任何响应重复下发。
  const r = await db.prepare(
    `UPDATE visits SET status = 'in_store', checked_in_at = ?, checkin_code = NULL
     WHERE id = ? AND status = 'reserved' AND reserved_at >= ?`,
  ).bind(unixNow(), id, unixNow() - RESERVATION_TTL).run();
  if ((r.meta.changes ?? 0) === 0) {
    return { error: 'invalid_state' as const, visit: await getVisit(db, id) };
  }
  return { visit: await getVisit(db, id) };
}

export async function checkoutVisit(db: D1Database, id: string, riderToken?: string) {
  const visit = await getVisit(db, id);
  if (!visit) return { error: 'not_found' as const };
  if (riderToken !== undefined && visit.rider_token !== riderToken) return { error: 'forbidden' as const };
  if (visit.status === 'completed') return { visit, already: true as const };
  if (visit.status !== 'in_store') return { error: 'invalid_state' as const, visit };
  const r = await db.prepare(
    `UPDATE visits SET status = 'completed', checked_out_at = ? WHERE id = ? AND status = 'in_store'`,
  ).bind(unixNow(), id).run();
  if ((r.meta.changes ?? 0) === 0) {
    return { error: 'invalid_state' as const, visit: await getVisit(db, id) };
  }
  return { visit: await getVisit(db, id) };
}

export async function cancelVisit(db: D1Database, id: string, riderToken: string) {
  const visit = await getVisit(db, id);
  if (!visit) return { error: 'not_found' as const };
  if (visit.rider_token !== riderToken) return { error: 'forbidden' as const };
  if (visit.status !== 'reserved') return { error: 'invalid_state' as const, visit };
  const r = await db.prepare(
    `UPDATE visits SET status = 'cancelled' WHERE id = ? AND status = 'reserved'`,
  ).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) {
    return { error: 'invalid_state' as const, visit: await getVisit(db, id) };
  }
  return { visit: await getVisit(db, id) };
}

// rider_token 脱敏：管理端列表不批量下发完整 token（等于批量下发"冒充骑手"的钥匙）
function maskToken(token: string): string {
  return token.length > 6 ? `${token.slice(0, 6)}…` : '…';
}

// 管理端：在店 / 今日记录
export async function listVisits(
  db: D1Database,
  opts: { status?: string; page?: number; page_size?: number } = {},
) {
  await expireStaleVisits(db);
  const { status, page = 1, page_size = 50 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (status) { wheres.push('v.status = ?'); bindings.push(status); }
  const { rows, total } = await paginate<Visit>(db, {
    select: 'v.*, sp.name as point_name',
    from: 'FROM visits v LEFT JOIN service_points sp ON sp.id = v.point_id',
    countFrom: 'FROM visits v',
    wheres, bindings, order: 'ORDER BY v.created_at DESC', page, page_size,
  });
  return {
    // rider_token 脱敏，created_ip / checkin_code 属内部反滥用字段，一律不下发
    items: rows.map(({ created_ip, checkin_code, ...v }) => ({
      ...v, rider_token: maskToken(v.rider_token),
    })),
    total, page, page_size,
  };
}
