import type { ServicePoint, PointHistory } from '@/lib/types';
import { likeTerm } from '@/lib/like-term';
import { deserializePoint, paginate, parseJsonArray, parseJsonObject, unixNow, type RawPoint } from './helpers';

// ---------------------------------------------------------------------------
// Service Points
// ---------------------------------------------------------------------------

export async function listPoints(
  db: D1Database,
  opts: { city?: string; status?: string; q?: string; service?: string; page?: number; page_size?: number } = {},
) {
  const { city, status, q, service, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];

  if (city) { wheres.push('city = ?'); bindings.push(city); }
  if (status) { wheres.push('status = ?'); bindings.push(status); }
  // 检索词与 service 标签同口径归一（见 @/lib/like-term）：不过滤的话 q="%" 等于全表命中
  if (q) {
    const qq = likeTerm(q);
    if (qq) { wheres.push('(name LIKE ? OR address LIKE ?)'); bindings.push(`%${qq}%`, `%${qq}%`); }
  }
  // 服务标签筛选：services 列为 JSON 数组文本，按完整标签匹配
  if (service) {
    const tag = likeTerm(service);
    if (tag) { wheres.push("services LIKE ?"); bindings.push(`%"${tag}"%`); }
  }

  const { rows, total } = await paginate<RawPoint>(db, {
    select: '*', from: 'FROM service_points', countFrom: 'FROM service_points',
    wheres, bindings, order: 'ORDER BY updated_at DESC', page, page_size,
  });

  return { items: rows.map(deserializePoint), total, page, page_size };
}

// 首页三枚圆章的全量口径。B4：此前前端在"当前筛选 + 当前页"的 items 上现算开放数与
// 服务类型数，却与服务端下发的 total 混排——筛选一变，声称是平台规模的数字就跟着漂移。
// services 是 JSON 数组文本，去重标签在 SQL 里拆不动，一次全表取两列回来算。
export interface PointStats {
  total: number;
  open_count: number;
  service_types: number;
}

export async function getPointStats(db: D1Database): Promise<PointStats> {
  const rows = await db.prepare('SELECT status, services FROM service_points')
    .all<{ status: string; services: string }>();
  const items = rows.results ?? [];
  const tags = new Set<string>();
  let openCount = 0;
  for (const r of items) {
    if (r.status === 'open') openCount++;
    for (const t of parseJsonArray(r.services, 'service_points.services')) tags.add(t);
  }
  return { total: items.length, open_count: openCount, service_types: tags.size };
}

export async function getPoint(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM service_points WHERE id = ?')
    .bind(id).first<ServicePoint & { services: string; admission: string }>();
  return row ? deserializePoint(row) : null;
}

// created_by 是写路径独有的字段（管理员 id，供 DB 侧审计），不出现在读出来的 ServicePoint 上
export async function createPoint(
  db: D1Database,
  data: Omit<ServicePoint, 'id' | 'created_at' | 'updated_at'> & { created_by?: string | null },
) {
  const now = unixNow();
  const result = await db.prepare(
    `INSERT INTO service_points
       (name,address,lat,lng,city,district,contact_phone,open_hours,status,
        services,admission,notes,verified_at,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    data.name, data.address, data.lat, data.lng, data.city, data.district,
    data.contact_phone, data.open_hours, data.status,
    JSON.stringify(data.services), JSON.stringify(data.admission),
    data.notes,
    data.verified_at ?? null, data.created_by ?? null,
    now, now,
  ).run();
  return result;
}

export async function updatePoint(
  db: D1Database,
  id: string,
  data: Partial<Omit<ServicePoint, 'id' | 'created_at'>>,
) {
  const now = unixNow();
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [now];

  const cols: (keyof typeof data)[] = [
    'name','address','lat','lng','city','district','contact_phone','open_hours',
    'status','notes','verified_at',
  ];
  for (const col of cols) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  if (data.services !== undefined) { sets.push('services = ?'); bindings.push(JSON.stringify(data.services)); }
  if (data.admission !== undefined) { sets.push('admission = ?'); bindings.push(JSON.stringify(data.admission)); }

  bindings.push(id);
  await db.prepare(`UPDATE service_points SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

// 变更前快照。没有"变更摘要"参数：此前调用方传的恒为写死的"管理员更新"（提交体里
// 根本没有 change_summary 字段），一行假数据换不来任何可追溯性，改读 snapshot 本体。
export async function snapshotPoint(
  db: D1Database,
  pointId: string,
  changedBy: string | null,
) {
  const point = await getPoint(db, pointId);
  if (!point) return;
  await db.prepare(
    `INSERT INTO point_history (point_id, changed_by, changed_at, snapshot)
     VALUES (?, ?, ?, ?)`,
  ).bind(pointId, changedBy, unixNow(), JSON.stringify(point)).run();
}

export async function listPointHistory(db: D1Database, pointId: string) {
  const rows = await db.prepare(
    `SELECT ph.*, au.display_name as changed_by_name
     FROM point_history ph
     LEFT JOIN admin_users au ON au.id = ph.changed_by
     WHERE ph.point_id = ? ORDER BY ph.changed_at DESC LIMIT 50`,
  ).bind(pointId).all<PointHistory & { snapshot: string }>();
  return (rows.results ?? []).map(r => ({
    ...r,
    snapshot: parseJsonObject<ServicePoint>(r.snapshot, 'point_history.snapshot'),
  }));
}

// ---------------------------------------------------------------------------
// Point Confirms（骑手一键确认「信息无误」）+ 点位实时信号
// ---------------------------------------------------------------------------

// 骑手「信息无误」确认：同一点位同一设备 30 天内只计一次（无身份去重时可被脚本刷量）
export async function confirmPoint(db: D1Database, pointId: string, riderToken: string) {
  const monthAgo = unixNow() - 30 * 86400;
  // 单条 INSERT ... WHERE NOT EXISTS：并发下同一 rider 不会双写计数
  await db.prepare(
    `INSERT INTO point_confirms (point_id, rider_token, created_at)
     SELECT ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM point_confirms
       WHERE point_id = ? AND rider_token = ? AND created_at >= ?
     )`,
  ).bind(pointId, riderToken, unixNow(), pointId, riderToken, monthAgo).run();
  const row = await db.prepare('SELECT COUNT(*) as n FROM point_confirms WHERE point_id = ?')
    .bind(pointId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface PointSignals {
  pending_reports_30d: number;
  confirm_count: number;
  last_inspection: { result: string; inspected_at: number } | null;
}

export async function getPointSignals(db: D1Database, pointId: string): Promise<PointSignals> {
  const since = unixNow() - 30 * 86400;
  const [rep, conf, insp] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) as n FROM reports
       WHERE point_id = ? AND status IN ('pending','processing') AND created_at >= ?`,
    ).bind(pointId, since).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM point_confirms WHERE point_id = ?')
      .bind(pointId).first<{ n: number }>(),
    db.prepare(
      'SELECT result, inspected_at FROM inspections WHERE point_id = ? ORDER BY inspected_at DESC LIMIT 1',
    ).bind(pointId).first<{ result: string; inspected_at: number }>(),
  ]);
  return {
    pending_reports_30d: rep?.n ?? 0,
    confirm_count: conf?.n ?? 0,
    last_inspection: insp ?? null,
  };
}
