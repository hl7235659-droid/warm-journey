import type { ServicePoint, Report, WorkOrder, Inspection, AdminUser, PointHistory } from '@/lib/types';

export type D1Env = { DB: D1Database };

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
  if (q) { wheres.push('(name LIKE ? OR address LIKE ?)'); bindings.push(`%${q}%`, `%${q}%`); }
  // 服务标签筛选：services 列为 JSON 数组文本，按完整标签匹配（过滤通配符防注入）
  if (service) {
    const tag = service.replace(/[%_"\\]/g, '').trim();
    if (tag) { wheres.push("services LIKE ?"); bindings.push(`%"${tag}"%`); }
  }

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;

  const [rows, countRow] = await Promise.all([
    db.prepare(`SELECT * FROM service_points ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, page_size, offset).all<ServicePoint & { services: string; admission: string }>(),
    db.prepare(`SELECT COUNT(*) as n FROM service_points ${where}`)
      .bind(...bindings).first<{ n: number }>(),
  ]);

  return {
    items: (rows.results ?? []).map(deserializePoint),
    total: countRow?.n ?? 0,
    page,
    page_size,
  };
}

export async function getPoint(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM service_points WHERE id = ?')
    .bind(id).first<ServicePoint & { services: string; admission: string }>();
  return row ? deserializePoint(row) : null;
}

export async function createPoint(
  db: D1Database,
  data: Omit<ServicePoint, 'id' | 'created_at' | 'updated_at'>,
) {
  const now = unixNow();
  const result = await db.prepare(
    `INSERT INTO service_points
       (name,address,lat,lng,city,district,contact_phone,open_hours,status,
        services,admission,notes,qr_code_url,verified_at,verified_by,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    data.name, data.address, data.lat, data.lng, data.city, data.district,
    data.contact_phone, data.open_hours, data.status,
    JSON.stringify(data.services), JSON.stringify(data.admission),
    data.notes, data.qr_code_url,
    data.verified_at ?? null, data.verified_by ?? null, data.created_by ?? null,
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
    'status','notes','qr_code_url','verified_at','verified_by',
  ];
  for (const col of cols) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  if (data.services !== undefined) { sets.push('services = ?'); bindings.push(JSON.stringify(data.services)); }
  if (data.admission !== undefined) { sets.push('admission = ?'); bindings.push(JSON.stringify(data.admission)); }

  bindings.push(id);
  await db.prepare(`UPDATE service_points SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

export async function snapshotPoint(
  db: D1Database,
  pointId: string,
  changedBy: string | null,
  summary: string,
) {
  const point = await getPoint(db, pointId);
  if (!point) return;
  await db.prepare(
    `INSERT INTO point_history (point_id, changed_by, changed_at, change_summary, snapshot)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(pointId, changedBy, unixNow(), summary, JSON.stringify(point)).run();
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
    snapshot: JSON.parse(r.snapshot) as ServicePoint,
  }));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function createReport(
  db: D1Database,
  data: { point_id: string; category: string; content: string; images: string[] },
) {
  // 显式生成 id（与表默认值同格式：16 位小写 hex），
  // 因为要把它作为骑手的「查询码」返回，D1 run() 的 last_row_id 拿不到 TEXT 主键。
  const id = genId();
  await db.prepare(
    `INSERT INTO reports (id, point_id, category, content, images, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, data.point_id, data.category, data.content, JSON.stringify(data.images), unixNow()).run();
  return id;
}

// 免登录进度查询：凭查询码（report id 前缀，≥6 位）查单条上报
export async function getReportByCode(db: D1Database, code: string) {
  if (!/^[0-9a-f]{6,16}$/.test(code)) return null;
  return db.prepare(
    `SELECT r.id, r.point_id, r.category, r.content, r.status, r.created_at,
            sp.name as point_name
     FROM reports r
     LEFT JOIN service_points sp ON sp.id = r.point_id
     WHERE r.id LIKE ?
     ORDER BY r.created_at DESC LIMIT 1`,
  ).bind(`${code}%`).first<{
    id: string; point_id: string; category: string; content: string;
    status: string; created_at: number; point_name?: string;
  }>();
}

export async function listReports(
  db: D1Database,
  opts: { point_id?: string; status?: string; page?: number; page_size?: number } = {},
) {
  const { point_id, status, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (point_id) { wheres.push('r.point_id = ?'); bindings.push(point_id); }
  if (status) { wheres.push('r.status = ?'); bindings.push(status); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT r.*, sp.name as point_name FROM reports r
       LEFT JOIN service_points sp ON sp.id = r.point_id
       ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, page_size, offset).all<Report & { images: string; point_name?: string }>(),
    db.prepare(`SELECT COUNT(*) as n FROM reports r ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return {
    items: (rows.results ?? []).map(r => ({ ...r, images: JSON.parse(r.images) as string[] })),
    total: count?.n ?? 0, page, page_size,
  };
}

export async function updateReport(db: D1Database, id: string, data: Partial<Report>) {
  const sets: string[] = [];
  const bindings: unknown[] = [];
  if (data.status) { sets.push('status = ?'); bindings.push(data.status); }
  if (data.work_order_id !== undefined) { sets.push('work_order_id = ?'); bindings.push(data.work_order_id); }
  if (!sets.length) return;
  bindings.push(id);
  await db.prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

// ---------------------------------------------------------------------------
// Work Orders
// ---------------------------------------------------------------------------

export async function createWorkOrder(
  db: D1Database,
  data: Omit<WorkOrder, 'id' | 'created_at' | 'updated_at' | 'resolved_at'>,
) {
  const now = unixNow();
  return db.prepare(
    `INSERT INTO work_orders
       (title,description,point_id,report_id,assigned_to,status,priority,resolution_note,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    data.title, data.description, data.point_id ?? null, data.report_id ?? null,
    data.assigned_to ?? null, data.status, data.priority, data.resolution_note,
    data.created_by ?? null, now, now,
  ).run();
}

export async function listWorkOrders(
  db: D1Database,
  opts: { status?: string; point_id?: string; page?: number; page_size?: number } = {},
) {
  const { status, point_id, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (status) { wheres.push('wo.status = ?'); bindings.push(status); }
  if (point_id) { wheres.push('wo.point_id = ?'); bindings.push(point_id); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT wo.*, sp.name as point_name, au.display_name as assigned_name
       FROM work_orders wo
       LEFT JOIN service_points sp ON sp.id = wo.point_id
       LEFT JOIN admin_users au ON au.id = wo.assigned_to
       ${where} ORDER BY wo.updated_at DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, page_size, offset).all<WorkOrder>(),
    db.prepare(`SELECT COUNT(*) as n FROM work_orders wo ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return { items: rows.results ?? [], total: count?.n ?? 0, page, page_size };
}

export async function getWorkOrder(db: D1Database, id: string) {
  return db.prepare(
    `SELECT wo.*, sp.name as point_name, au.display_name as assigned_name
     FROM work_orders wo
     LEFT JOIN service_points sp ON sp.id = wo.point_id
     LEFT JOIN admin_users au ON au.id = wo.assigned_to
     WHERE wo.id = ?`,
  ).bind(id).first<WorkOrder>();
}

export async function updateWorkOrder(db: D1Database, id: string, data: Partial<WorkOrder>) {
  const now = unixNow();
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [now];
  const cols: (keyof WorkOrder)[] = ['title','description','assigned_to','status','priority','resolution_note'];
  for (const col of cols) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  if (data.status === 'resolved' && !data.resolved_at) {
    sets.push('resolved_at = ?'); bindings.push(now);
  }
  bindings.push(id);
  await db.prepare(`UPDATE work_orders SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

export async function createInspection(
  db: D1Database,
  data: Omit<Inspection, 'id' | 'created_at'>,
) {
  const now = unixNow();
  return db.prepare(
    `INSERT INTO inspections (point_id, inspector_id, result, findings, images, notes, inspected_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(
    data.point_id, data.inspector_id ?? null, data.result,
    JSON.stringify(data.findings), JSON.stringify(data.images),
    data.notes, data.inspected_at ?? now, now,
  ).run();
}

export async function listInspections(
  db: D1Database,
  opts: { point_id?: string; page?: number; page_size?: number } = {},
) {
  const { point_id, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (point_id) { wheres.push('i.point_id = ?'); bindings.push(point_id); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT i.*, sp.name as point_name, au.display_name as inspector_name
       FROM inspections i
       LEFT JOIN service_points sp ON sp.id = i.point_id
       LEFT JOIN admin_users au ON au.id = i.inspector_id
       ${where} ORDER BY i.inspected_at DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, page_size, offset).all<Inspection & { findings: string; images: string }>(),
    db.prepare(`SELECT COUNT(*) as n FROM inspections i ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return {
    items: (rows.results ?? []).map(r => ({
      ...r,
      findings: JSON.parse(r.findings) as string[],
      images: JSON.parse(r.images) as string[],
    })),
    total: count?.n ?? 0, page, page_size,
  };
}

// ---------------------------------------------------------------------------
// Admin Users
// ---------------------------------------------------------------------------

export async function getAdminByUsername(db: D1Database, username: string) {
  return db.prepare('SELECT * FROM admin_users WHERE username = ?')
    .bind(username).first<AdminUser & { password_hash: string }>();
}

export async function updateLastLogin(db: D1Database, id: string) {
  await db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?')
    .bind(unixNow(), id).run();
}

export async function listAdmins(db: D1Database) {
  const rows = await db.prepare(
    'SELECT id, username, role, display_name, created_at, last_login_at FROM admin_users ORDER BY created_at',
  ).all<AdminUser>();
  return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// Point Confirms（骑手一键确认「信息无误」）+ 点位实时信号
// ---------------------------------------------------------------------------

export async function confirmPoint(db: D1Database, pointId: string) {
  await db.prepare('INSERT INTO point_confirms (point_id, created_at) VALUES (?, ?)')
    .bind(pointId, unixNow()).run();
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

// ---------------------------------------------------------------------------
// Cities（多城市）
// ---------------------------------------------------------------------------

export interface City {
  id: string; name: string; center_lat: number; center_lng: number;
  enabled: number; created_at: number;
}

export async function listEnabledCities(db: D1Database) {
  const rows = await db.prepare(
    'SELECT * FROM cities WHERE enabled = 1 ORDER BY created_at',
  ).all<City>();
  return rows.results ?? [];
}

export async function listCities(db: D1Database) {
  const rows = await db.prepare('SELECT * FROM cities ORDER BY created_at').all<City>();
  return rows.results ?? [];
}

export async function createCity(
  db: D1Database,
  data: { name: string; center_lat: number; center_lng: number },
) {
  const id = genId();
  await db.prepare(
    'INSERT INTO cities (id, name, center_lat, center_lng, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  ).bind(id, data.name, data.center_lat, data.center_lng, unixNow()).run();
  return id;
}

export async function updateCity(
  db: D1Database,
  id: string,
  data: { name?: string; center_lat?: number; center_lng?: number; enabled?: number },
) {
  const sets: string[] = [];
  const bindings: unknown[] = [];
  for (const col of ['name', 'center_lat', 'center_lng', 'enabled'] as const) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  if (!sets.length) return;
  bindings.push(id);
  await db.prepare(`UPDATE cities SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

// ---------------------------------------------------------------------------
// Admin Stats（数据看板）
// ---------------------------------------------------------------------------

export interface AdminStats {
  points_total: number;
  points_open: number;
  reports_pending: number;
  reports_processing: number;
  orders_open: number;
  orders_in_progress: number;
  inspections_30d: number;
  confirms_total: number;
  cities_enabled: number;
  in_store_now: number;
  visits_today: number;
  avg_rating: number | null;
}

export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  const since = unixNow() - 30 * 86400;
  const todayStart = unixNow() - (unixNow() % 86400) - 8 * 3600; // 北京时间 0 点（近似）
  const q = (sql: string, ...b: unknown[]) =>
    db.prepare(sql).bind(...b).first<{ n: number }>().then(r => r?.n ?? 0);
  const [
    points_total, points_open, reports_pending, reports_processing,
    orders_open, orders_in_progress, inspections_30d, confirms_total, cities_enabled,
    in_store_now, visits_today,
  ] = await Promise.all([
    q('SELECT COUNT(*) as n FROM service_points'),
    q("SELECT COUNT(*) as n FROM service_points WHERE status = 'open'"),
    q("SELECT COUNT(*) as n FROM reports WHERE status = 'pending'"),
    q("SELECT COUNT(*) as n FROM reports WHERE status = 'processing'"),
    q("SELECT COUNT(*) as n FROM work_orders WHERE status = 'open'"),
    q("SELECT COUNT(*) as n FROM work_orders WHERE status = 'in_progress'"),
    q('SELECT COUNT(*) as n FROM inspections WHERE inspected_at >= ?', since),
    q('SELECT COUNT(*) as n FROM point_confirms'),
    q('SELECT COUNT(*) as n FROM cities WHERE enabled = 1'),
    q("SELECT COUNT(*) as n FROM visits WHERE status = 'in_store'"),
    q('SELECT COUNT(*) as n FROM visits WHERE created_at >= ?', todayStart),
  ]);
  const rating = await db.prepare('SELECT AVG(rating) as a FROM visit_feedback').first<{ a: number | null }>();
  return {
    points_total, points_open, reports_pending, reports_processing,
    orders_open, orders_in_progress, inspections_30d, confirms_total, cities_enabled,
    in_store_now, visits_today,
    avg_rating: rating?.a ? Math.round(rating.a * 10) / 10 : null,
  };
}

// 热力图数据：每个点位的坐标 + 近 90 天上报数（权重）
export async function getHeatmapData(db: D1Database) {
  const since = unixNow() - 90 * 86400;
  const rows = await db.prepare(
    `SELECT sp.id, sp.name, sp.lat, sp.lng, sp.status,
            (SELECT COUNT(*) FROM reports r WHERE r.point_id = sp.id AND r.created_at >= ?) as report_count
     FROM service_points sp`,
  ).bind(since).all<{
    id: string; name: string; lat: number; lng: number; status: string; report_count: number;
  }>();
  return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// Admin Users 管理（仅 super_admin 可用，权限在 API 层校验）
// ---------------------------------------------------------------------------

export async function createAdmin(
  db: D1Database,
  data: { username: string; password_hash: string; role: string; display_name: string },
) {
  const id = genId();
  await db.prepare(
    `INSERT INTO admin_users (id, username, password_hash, role, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, data.username, data.password_hash, data.role, data.display_name, unixNow(), unixNow()).run();
  return id;
}

export async function updateAdmin(
  db: D1Database,
  id: string,
  data: { password_hash?: string; role?: string; display_name?: string },
) {
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [unixNow()];
  for (const col of ['password_hash', 'role', 'display_name'] as const) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  bindings.push(id);
  await db.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

export async function deleteAdmin(db: D1Database, id: string) {
  await db.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
}

// ---------------------------------------------------------------------------
// 上报 → 工单自动流转：同一点位 pending 上报 ≥ 3 条时自动开工单并关联
// ---------------------------------------------------------------------------

export const AUTO_ORDER_THRESHOLD = 3;

export async function maybeAutoCreateWorkOrder(db: D1Database, pointId: string) {
  const pending = await db.prepare(
    `SELECT r.id FROM reports r
     WHERE r.point_id = ? AND r.status = 'pending' AND r.work_order_id IS NULL
     ORDER BY r.created_at`,
  ).bind(pointId).all<{ id: string }>();
  const ids = (pending.results ?? []).map(r => r.id);
  if (ids.length < AUTO_ORDER_THRESHOLD) return null;

  const point = await getPoint(db, pointId);
  const orderId = genId();
  const now = unixNow();
  await db.prepare(
    `INSERT INTO work_orders
       (id, title, description, point_id, report_id, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', 'high', ?, ?)`,
  ).bind(
    orderId,
    `【自动】${point?.name ?? '服务点'}集中上报异常（${ids.length} 条）`,
    `系统检测到该点位 ${ids.length} 条待核实上报，自动创建工单。`,
    pointId, ids[0], now, now,
  ).run();

  // 关联所有 pending 上报并置为 processing
  const placeholders = ids.map(() => '?').join(',');
  await db.prepare(
    `UPDATE reports SET status = 'processing', work_order_id = ? WHERE id IN (${placeholders})`,
  ).bind(orderId, ...ids).run();

  return orderId;
}

// ---------------------------------------------------------------------------
// Visits（预约进店 / 扫码离店 / 在店人数）
// ---------------------------------------------------------------------------

import type { Visit, VisitFeedback } from '@/lib/types';

// 预约名额保留时长：2 小时
export const RESERVATION_TTL = 2 * 3600;
// 入店超过该时长未扫码离店 → 自动离店，防止人数虚高
export const AUTO_CHECKOUT_AFTER = 4 * 3600;

// 懒清理：超时 reserved → expired；超时在店 → 自动 completed。
// 涉及占用统计前都要先跑。
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

export async function getOccupancy(db: D1Database, pointId: string): Promise<Occupancy> {
  await expireStaleVisits(db);
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

// 预约：同一点位同一骑手有进行中 visit 则直接返回它（幂等）；
// 容量校验：在店 + 有效预约 ≥ capacity 时拒绝。
export async function reserveVisit(db: D1Database, pointId: string, riderToken: string) {
  await expireStaleVisits(db);
  const existing = await db.prepare(
    `SELECT * FROM visits WHERE point_id = ? AND rider_token = ? AND status IN ('reserved','in_store')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(pointId, riderToken).first<Visit>();
  if (existing) return { visit: existing, created: false as const };

  const occ = await getOccupancy(db, pointId);
  if (occ.capacity !== null && occ.in_store + occ.reserved >= occ.capacity) {
    return { visit: null, created: false as const, full: true as const };
  }

  const id = genId();
  const now = unixNow();
  await db.prepare(
    `INSERT INTO visits (id, point_id, rider_token, status, reserved_at, created_at)
     VALUES (?, ?, ?, 'reserved', ?, ?)`,
  ).bind(id, pointId, riderToken, now, now).run();
  const visit = await getVisit(db, id);
  return { visit, created: true as const };
}

export async function getVisit(db: D1Database, id: string) {
  return db.prepare(
    `SELECT v.*, sp.name as point_name FROM visits v
     LEFT JOIN service_points sp ON sp.id = v.point_id WHERE v.id = ?`,
  ).bind(id).first<Visit>();
}

// 骑手在某点位的进行中 visit（离店页 / 详情页用）
export async function getActiveVisit(db: D1Database, pointId: string, riderToken: string) {
  await expireStaleVisits(db);
  return db.prepare(
    `SELECT * FROM visits WHERE point_id = ? AND rider_token = ? AND status IN ('reserved','in_store')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(pointId, riderToken).first<Visit>();
}

export async function checkinVisit(db: D1Database, id: string) {
  await expireStaleVisits(db);
  const visit = await getVisit(db, id);
  if (!visit) return { error: 'not_found' as const };
  if (visit.status === 'in_store') return { visit, already: true as const };
  if (visit.status !== 'reserved') return { error: 'invalid_state' as const, visit };
  await db.prepare(`UPDATE visits SET status = 'in_store', checked_in_at = ? WHERE id = ?`)
    .bind(unixNow(), id).run();
  return { visit: await getVisit(db, id) };
}

export async function checkoutVisit(db: D1Database, id: string, riderToken?: string) {
  const visit = await getVisit(db, id);
  if (!visit) return { error: 'not_found' as const };
  if (riderToken !== undefined && visit.rider_token !== riderToken) return { error: 'forbidden' as const };
  if (visit.status === 'completed') return { visit, already: true as const };
  if (visit.status !== 'in_store') return { error: 'invalid_state' as const, visit };
  await db.prepare(`UPDATE visits SET status = 'completed', checked_out_at = ? WHERE id = ?`)
    .bind(unixNow(), id).run();
  return { visit: await getVisit(db, id) };
}

export async function cancelVisit(db: D1Database, id: string, riderToken: string) {
  const visit = await getVisit(db, id);
  if (!visit) return { error: 'not_found' as const };
  if (visit.rider_token !== riderToken) return { error: 'forbidden' as const };
  if (visit.status !== 'reserved') return { error: 'invalid_state' as const, visit };
  await db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  return { visit: await getVisit(db, id) };
}

// 管理端：在店 / 今日记录
export async function listVisits(
  db: D1Database,
  opts: { point_id?: string; status?: string; page?: number; page_size?: number } = {},
) {
  await expireStaleVisits(db);
  const { point_id, status, page = 1, page_size = 50 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (point_id) { wheres.push('v.point_id = ?'); bindings.push(point_id); }
  if (status) { wheres.push('v.status = ?'); bindings.push(status); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT v.*, sp.name as point_name FROM visits v
       LEFT JOIN service_points sp ON sp.id = v.point_id
       ${where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, page_size, offset).all<Visit>(),
    db.prepare(`SELECT COUNT(*) as n FROM visits v ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return { items: rows.results ?? [], total: count?.n ?? 0, page, page_size };
}

// ---------------------------------------------------------------------------
// Visit Feedback（离店满意度）
// ---------------------------------------------------------------------------

export async function createVisitFeedback(
  db: D1Database,
  data: { visit_id: string; rating: number; supports: string[]; suggestion: string },
) {
  const visit = await getVisit(db, data.visit_id);
  if (!visit) return { error: 'not_found' as const };
  if (visit.status !== 'completed') return { error: 'invalid_state' as const };
  const dup = await db.prepare('SELECT id FROM visit_feedback WHERE visit_id = ?')
    .bind(data.visit_id).first<{ id: string }>();
  if (dup) return { error: 'duplicate' as const };
  const id = genId();
  await db.prepare(
    `INSERT INTO visit_feedback (id, visit_id, point_id, rating, supports, suggestion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, data.visit_id, visit.point_id, data.rating,
    JSON.stringify(data.supports), data.suggestion, unixNow()).run();
  return { id };
}

export async function listVisitFeedback(
  db: D1Database,
  opts: { point_id?: string; page?: number; page_size?: number } = {},
) {
  const { point_id, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (point_id) { wheres.push('f.point_id = ?'); bindings.push(point_id); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;
  const [rows, count, avg] = await Promise.all([
    db.prepare(
      `SELECT f.*, sp.name as point_name FROM visit_feedback f
       LEFT JOIN service_points sp ON sp.id = f.point_id
       ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, page_size, offset).all<VisitFeedback & { supports: string }>(),
    db.prepare(`SELECT COUNT(*) as n FROM visit_feedback f ${where}`).bind(...bindings).first<{ n: number }>(),
    db.prepare(`SELECT AVG(rating) as a FROM visit_feedback f ${where}`).bind(...bindings).first<{ a: number | null }>(),
  ]);
  return {
    items: (rows.results ?? []).map(r => ({ ...r, supports: JSON.parse(r.supports) as string[] })),
    total: count?.n ?? 0,
    avg_rating: avg?.a ? Math.round(avg.a * 10) / 10 : null,
    page, page_size,
  };
}

// ---------------------------------------------------------------------------
// AI 助手（知识库 / 动态上下文 / 口碑聚合 / 限流）
// ---------------------------------------------------------------------------

export type AiKnowledgeCategory = 'rights' | 'channel' | 'faq' | 'notice';

export interface AiKnowledge {
  id: string;
  category: AiKnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  enabled: boolean;
  updated_at: number;
}

type RawKnowledge = Omit<AiKnowledge, 'tags' | 'enabled'> & { tags: string; enabled: number };

function deserializeKnowledge(r: RawKnowledge): AiKnowledge {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags) as string[]; } catch { /* 坏数据容忍 */ }
  return { ...r, tags, enabled: r.enabled === 1 };
}

export async function listKnowledge(
  db: D1Database,
  opts: { category?: string; enabled?: boolean; q?: string; page?: number; page_size?: number } = {},
) {
  const { category, enabled, q, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (category) { wheres.push('category = ?'); bindings.push(category); }
  if (enabled !== undefined) { wheres.push('enabled = ?'); bindings.push(enabled ? 1 : 0); }
  if (q) {
    wheres.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)');
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const offset = (page - 1) * page_size;
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT * FROM ai_knowledge ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, page_size, offset).all<RawKnowledge>(),
    db.prepare(`SELECT COUNT(*) as n FROM ai_knowledge ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return { items: (rows.results ?? []).map(deserializeKnowledge), total: count?.n ?? 0, page, page_size };
}

export async function createKnowledge(
  db: D1Database,
  data: { category: string; title: string; content: string; tags: string[] },
) {
  const id = genId();
  await db.prepare(
    `INSERT INTO ai_knowledge (id, category, title, content, tags, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).bind(id, data.category, data.title, data.content, JSON.stringify(data.tags), unixNow()).run();
  return id;
}

export async function updateKnowledge(
  db: D1Database,
  id: string,
  data: { category?: string; title?: string; content?: string; tags?: string[]; enabled?: boolean },
) {
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [unixNow()];
  if (data.category !== undefined) { sets.push('category = ?'); bindings.push(data.category); }
  if (data.title !== undefined) { sets.push('title = ?'); bindings.push(data.title); }
  if (data.content !== undefined) { sets.push('content = ?'); bindings.push(data.content); }
  if (data.tags !== undefined) { sets.push('tags = ?'); bindings.push(JSON.stringify(data.tags)); }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); bindings.push(data.enabled ? 1 : 0); }
  bindings.push(id);
  await db.prepare(`UPDATE ai_knowledge SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

export async function deleteKnowledge(db: D1Database, id: string) {
  await db.prepare('DELETE FROM ai_knowledge WHERE id = ?').bind(id).run();
}

// 知识检索（注入 prompt 用）：tags/标题/正文命中计分，取 topN
export async function searchKnowledge(
  db: D1Database,
  query: string,
  opts: { category?: string; topN?: number } = {},
) {
  const { category, topN = 3 } = opts;
  const rows = await db.prepare(
    `SELECT * FROM ai_knowledge WHERE enabled = 1 ${category ? 'AND category = ?' : ''}
     ORDER BY updated_at DESC LIMIT 50`,
  ).bind(...(category ? [category] : [])).all<RawKnowledge>();
  const q = (query || '').trim().toLowerCase();
  const items = (rows.results ?? []).map(deserializeKnowledge);
  if (!q) return items.slice(0, topN);
  const scored = items
    .map((k) => {
      let score = 0;
      for (const t of k.tags) if (q.includes(t.toLowerCase())) score += 2;
      if (k.title.toLowerCase().includes(q)) score += 1;
      for (const seg of q.split(/[\s，。？！、]+/)) {
        if (seg.length >= 2 && k.content.toLowerCase().includes(seg)) score += 1;
      }
      return { k, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.k);
}

// ---------- 动态上下文：附近开放站点 + 在店人数 + crowdHint ----------

// haversine（米）——与首页前端同口径
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// crowdHint：近14天同星期同小时段的到店均值（SQL 一次聚合），与当前在店人数对比
async function crowdHintFor(db: D1Database, pointId: string, inStore: number, capacity: number | null): Promise<string> {
  if (capacity !== null && inStore >= capacity) return '名额已满';
  const twoWeeksAgo = unixNow() - 14 * 86400;
  const row = await db.prepare(
    `SELECT COUNT(*) as n,
            COUNT(DISTINCT date(checked_in_at, 'unixepoch')) as days
     FROM visits
     WHERE point_id = ? AND status IN ('in_store','completed')
       AND checked_in_at >= ?
       AND strftime('%w', checked_in_at, 'unixepoch') = strftime('%w', 'now')
       AND CAST(strftime('%H', checked_in_at, 'unixepoch') AS INTEGER) = CAST(strftime('%H','now') AS INTEGER)`,
  ).bind(pointId, twoWeeksAgo).first<{ n: number; days: number }>();
  const days = row?.days ?? 0;
  if (!days) return '暂无历史规律';
  const avg = (row?.n ?? 0) / days;
  if (avg <= 0) return inStore === 0 ? '暂无历史规律' : '当前较空';
  if (inStore >= avg * 1.3) return '高峰时段';
  if (inStore <= avg * 0.7) return '当前较空';
  return '与平时相近';
}

export interface NearbyContextPoint {
  id: string;
  name: string;
  dist: string;
  inStore: number;
  openHours: string;
  services: string[];
  crowdHint: string;
}

export async function getNearbyPoints(
  db: D1Database,
  lat: number,
  lng: number,
  limit = 3,
): Promise<NearbyContextPoint[]> {
  await expireStaleVisits(db);
  const rows = await db.prepare(
    `SELECT id, name, lat, lng, open_hours, services FROM service_points
     WHERE status = 'open' ORDER BY updated_at DESC LIMIT 200`,
  ).all<{ id: string; name: string; lat: number; lng: number; open_hours: string; services: string }>();
  const ranked = (rows.results ?? [])
    .map((r) => ({ row: r, distM: haversineMeters(lat, lng, r.lat, r.lng) }))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, limit);

  return Promise.all(
    ranked.map(async ({ row, distM }) => {
      const occ = await getOccupancy(db, row.id);
      const hint = await crowdHintFor(db, row.id, occ.in_store, occ.capacity);
      let services: string[] = [];
      try { services = JSON.parse(row.services) as string[]; } catch { /* ignore */ }
      return {
        id: row.id,
        name: row.name,
        dist: formatDistance(distM),
        inStore: occ.in_store,
        openHours: row.open_hours,
        services,
        crowdHint: hint,
      };
    }),
  );
}

// ---------- T2 口碑聚合（详情页"问小暖"注入 prompt） ----------

export interface PointFeedbackSummaryData {
  count: number;
  avgRating: number | null;
  goodRate: number | null;        // 4分及以上占比
  topSupports: Array<{ tag: string; n: number }>;
  recentSuggestions: string[];    // 最近3条非空建议
}

export async function getPointFeedbackSummary(db: D1Database, pointId: string): Promise<PointFeedbackSummaryData | null> {
  const monthAgo = unixNow() - 30 * 86400;
  const rows = await db.prepare(
    `SELECT rating, supports, suggestion FROM visit_feedback
     WHERE point_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(pointId, monthAgo).all<{ rating: number; supports: string; suggestion: string }>();
  const list = rows.results ?? [];
  if (list.length === 0) return null;
  const total = list.reduce((s, r) => s + r.rating, 0);
  const good = list.filter((r) => r.rating >= 4).length;
  const supportsCount = new Map<string, number>();
  for (const r of list) {
    try {
      for (const t of JSON.parse(r.supports) as string[]) {
        supportsCount.set(t, (supportsCount.get(t) ?? 0) + 1);
      }
    } catch { /* ignore */ }
  }
  const topSupports = [...supportsCount.entries()]
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const recentSuggestions = list
    .map((r) => (r.suggestion || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return {
    count: list.length,
    avgRating: Math.round((total / list.length) * 10) / 10,
    goodRate: Math.round((good / list.length) * 100),
    topSupports,
    recentSuggestions,
  };
}

// ---------- AI 限流（每 IP 每分钟 N 次） ----------

export async function checkRateLimit(
  db: D1Database,
  key: string,
  opts: { limit?: number; windowSec?: number } = {},
): Promise<boolean> {
  const { limit = 20, windowSec = 60 } = opts;
  const now = unixNow();
  const windowStart = Math.floor(now / windowSec) * windowSec;
  await db.prepare(
    `INSERT INTO ai_rate (ip, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1`,
  ).bind(key, windowStart).run();
  const row = await db.prepare('SELECT count FROM ai_rate WHERE ip = ? AND window_start = ?')
    .bind(key, windowStart).first<{ count: number }>();
  // 顺手清理 1 天前的旧窗口（PK 范围删除，代价极小）
  if (now % 60 === 0) {
    await db.prepare('DELETE FROM ai_rate WHERE window_start < ?').bind(now - 86400).run();
  }
  return (row?.count ?? 0) <= limit;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unixNow() { return Math.floor(Date.now() / 1000); }

function genId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

type RawPoint = ServicePoint & { services: string; admission: string };
function deserializePoint(r: RawPoint): ServicePoint {
  return {
    ...r,
    services: JSON.parse(r.services) as string[],
    admission: JSON.parse(r.admission) as ServicePoint['admission'],
  };
}
