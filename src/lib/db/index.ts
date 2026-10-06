import type {
  ServicePoint, Report, WorkOrder, Inspection, AdminUser, PointHistory,
  Visit, VisitFeedback,
  KnowledgeCategory, ReportCategory, ReportStatus,
} from '@/lib/types';
import { FEEDBACK_SUPPORT_TAGS } from '@/lib/types';

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
// Reports
// ---------------------------------------------------------------------------

export async function createReport(
  db: D1Database,
  data: { point_id: string; category: string; content: string; images: string[] },
) {
  // 显式生成 id（与表默认值同格式：16 位小写 hex），D1 run() 的 last_row_id 拿不到 TEXT 主键。
  const id = genId();
  // 查询码为独立高熵字段（10 位 Crockford base32 ≈ 50 bit），
  // 不再暴露 report id 前缀，防止批量枚举他人上报。
  // 唯一索引撞码（概率极低）时重生成重试一次，而不是把 500 甩给用户。
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = genRandomCode();
    try {
      await db.prepare(
        `INSERT INTO reports (id, point_id, category, content, images, query_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, data.point_id, data.category, data.content, JSON.stringify(data.images), code, unixNow()).run();
      return { id, query_code: code };
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? '';
      if (msg.includes('UNIQUE') && msg.includes('query_code')) { lastErr = e; continue; }
      throw e;
    }
  }
  throw new Error(`查询码生成连续冲突：${(lastErr as { message?: string })?.message ?? 'unknown'}`);
}

// 免登录进度查询：凭查询码精确匹配。只返回进度必需字段，content 不对公网暴露。
// 旧版"report id 前 10 位"兼容分支已删：生产 reports 表 0 行、无存量旧码用户，
// 而唯一会写出旧码的入口（migrate-20261005 的回填）也已随批次 7 的迁移链退场。
export async function getReportByCode(db: D1Database, code: string) {
  const normalized = code.trim().toLowerCase();
  if (!/^[0-9a-z]{10}$/.test(normalized)) return null;
  return db.prepare(
    `SELECT r.id, r.point_id, r.category, r.status, r.created_at, sp.name as point_name
     FROM reports r LEFT JOIN service_points sp ON sp.id = r.point_id
     WHERE r.query_code = ? LIMIT 1`,
  ).bind(normalized).first<ReportStatusPublic>();
}

// category/status 由 schema.sql 的 CHECK 约束保证落在领域枚举内
export interface ReportStatusPublic {
  id: string; point_id: string; category: ReportCategory;
  status: ReportStatus; created_at: number; point_name?: string;
}

export async function listReports(
  db: D1Database,
  opts: { status?: string; page?: number; page_size?: number } = {},
) {
  const { status, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (status) { wheres.push('r.status = ?'); bindings.push(status); }
  const { rows, total } = await paginate<Report & { images: string; point_name?: string }>(db, {
    select: 'r.*, sp.name as point_name',
    from: 'FROM reports r LEFT JOIN service_points sp ON sp.id = r.point_id',
    countFrom: 'FROM reports r',
    wheres, bindings, order: 'ORDER BY r.created_at DESC', page, page_size,
  });
  return {
    items: rows.map(r => ({ ...r, images: parseJsonArray(r.images, 'reports.images') })),
    total, page, page_size,
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

// 显式生成 TEXT 主键 id 并返回：绝不能依赖 last_row_id（那是数字 rowid，
// 与 TEXT 主键无关——work_orders 关联曾因误用它而永久写错）。
export async function createWorkOrder(
  db: D1Database,
  data: Omit<WorkOrder, 'id' | 'created_at' | 'updated_at' | 'resolved_at'>,
): Promise<string> {
  const now = unixNow();
  const id = genId();
  await db.prepare(
    `INSERT INTO work_orders
       (id,title,description,point_id,report_id,status,priority,resolution_note,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id,
    data.title, data.description, data.point_id ?? null, data.report_id ?? null,
    data.status, data.priority, data.resolution_note,
    data.created_by ?? null, now, now,
  ).run();
  return id;
}

export async function listWorkOrders(
  db: D1Database,
  opts: { status?: string; page?: number; page_size?: number } = {},
) {
  const { status, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (status) { wheres.push('wo.status = ?'); bindings.push(status); }
  const { rows, total } = await paginate<WorkOrder>(db, {
    select: 'wo.*, sp.name as point_name',
    from: 'FROM work_orders wo LEFT JOIN service_points sp ON sp.id = wo.point_id',
    countFrom: 'FROM work_orders wo',
    wheres, bindings, order: 'ORDER BY wo.updated_at DESC', page, page_size,
  });
  return { items: rows, total, page, page_size };
}

export async function getWorkOrder(db: D1Database, id: string) {
  return db.prepare(
    `SELECT wo.*, sp.name as point_name
     FROM work_orders wo
     LEFT JOIN service_points sp ON sp.id = wo.point_id
     WHERE wo.id = ?`,
  ).bind(id).first<WorkOrder>();
}

export async function updateWorkOrder(db: D1Database, id: string, data: Partial<WorkOrder>) {
  const now = unixNow();
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [now];
  const cols: (keyof WorkOrder)[] = ['title','description','status','priority','resolution_note'];
  for (const col of cols) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  if ((data.status === 'resolved' || data.status === 'closed') && !data.resolved_at) {
    sets.push('resolved_at = ?'); bindings.push(now);
  }
  // 重开（resolved/closed → open/in_progress）时清空解决时间，保持状态机闭环
  if (data.status === 'open' || data.status === 'in_progress') {
    sets.push('resolved_at = NULL');
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
    `INSERT INTO inspections (point_id, inspector_id, result, images, notes, inspected_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(
    data.point_id, data.inspector_id ?? null, data.result,
    JSON.stringify(data.images),
    data.notes, data.inspected_at ?? now, now,
  ).run();
}

export async function listInspections(
  db: D1Database,
  opts: { page?: number; page_size?: number } = {},
) {
  const { page = 1, page_size = 20 } = opts;
  const { rows, total } = await paginate<Inspection & { images: string }>(db, {
    select: 'i.*, sp.name as point_name, au.display_name as inspector_name',
    from: `FROM inspections i
           LEFT JOIN service_points sp ON sp.id = i.point_id
           LEFT JOIN admin_users au ON au.id = i.inspector_id`,
    countFrom: 'FROM inspections i',
    order: 'ORDER BY i.inspected_at DESC', page, page_size,
  });
  return {
    items: rows.map(r => ({ ...r, images: parseJsonArray(r.images, 'inspections.images') })),
    total, page, page_size,
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

// ---------------------------------------------------------------------------
// Cities（多城市）
// ---------------------------------------------------------------------------

export interface City {
  id: string; name: string; center_lat: number; center_lng: number;
  enabled: number; created_at: number;
}

// 公网城市筛选器只要 id + name（首页 chip）；center_lat/lng 与 enabled 属管理端字段，
// 走 /api/admin/cities 的 listCities，不从公开接口整行下发。
export async function listEnabledCities(db: D1Database) {
  const rows = await db.prepare(
    'SELECT id, name FROM cities WHERE enabled = 1 ORDER BY created_at',
  ).all<Pick<City, 'id' | 'name'>>();
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
  if (!sets.length) return { changes: 0 };
  bindings.push(id);
  const r = await db.prepare(`UPDATE cities SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
  return { changes: r.meta.changes ?? 0 };
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

// 北京时间（UTC+8）当日 0 点的 unix 秒
function shanghaiDayStart(now = unixNow()): number {
  return Math.floor((now + 8 * 3600) / 86400) * 86400 - 8 * 3600;
}

export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  const since = unixNow() - 30 * 86400;
  // 统计前先清过期预约/超时在店，否则 in_store_now 虚高
  await expireStaleVisits(db);
  const todayStart = shanghaiDayStart();
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
  const r = await db.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
  return { changes: r.meta.changes ?? 0 };
}

export async function deleteAdmin(db: D1Database, id: string) {
  const r = await db.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  return { changes: r.meta.changes ?? 0 };
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

  // 建单 + 回写两步放进同一原子批，杜绝"孤儿工单"；
  // work_orders(report_id) 部分唯一索引兜底并发重复建单（首条 pending id 稳定）。
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO work_orders
           (id, title, description, point_id, report_id, status, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', 'high', ?, ?)`,
      ).bind(
        orderId,
        `【自动】${point?.name ?? '服务点'}集中上报异常（${ids.length} 条）`,
        `系统检测到该点位 ${ids.length} 条待核实上报，自动创建工单。`,
        pointId, ids[0], now, now,
      ),
      db.prepare(
        `UPDATE reports SET status = 'processing', work_order_id = ?
         WHERE point_id = ? AND status = 'pending' AND work_order_id IS NULL`,
      ).bind(orderId, pointId),
    ]);
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? '';
    // 并发触发时另一请求已建单 → 视为已处理
    if (msg.includes('UNIQUE')) return null;
    console.error('auto work order failed:', msg || 'unknown');
    return null;
  }
  return orderId;
}

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
  const expected = (visit as Visit & { checkin_code?: string | null }).checkin_code ?? '';
  if (!expected || expected !== code.trim().toLowerCase()) {
    return { error: 'bad_code' as const, visit };
  }
  if (visit.status === 'in_store') return { visit, already: true as const };
  if (visit.status !== 'reserved') return { error: 'invalid_state' as const, visit };
  // 条件 UPDATE 保证状态机安全迁移：并发 cancel/checkin 只有一个能成功。
  // reserved_at 谓词 = 预约 TTL：确认入店不在写路径跑 expireStaleVisits（P2-20），
  // 这里自带闸门，否则两小时前占位没到的预约会被扫成"已入店"，名额也被他占着。
  const r = await db.prepare(
    `UPDATE visits SET status = 'in_store', checked_in_at = ?
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

// ---------------------------------------------------------------------------
// Visit Feedback（离店满意度）
// ---------------------------------------------------------------------------

export async function createVisitFeedback(
  db: D1Database,
  data: { visit_id: string; rider_token: string; rating: number; supports: string[]; suggestion: string },
) {
  const visit = await getVisit(db, data.visit_id);
  if (!visit) return { error: 'not_found' as const };
  // 只有本人（rider_token 匹配）才能评价，防止拿 visit id 冒名抢占
  if (visit.rider_token !== data.rider_token) return { error: 'forbidden' as const };
  if (visit.status !== 'completed') return { error: 'invalid_state' as const };
  const dup = await db.prepare('SELECT id FROM visit_feedback WHERE visit_id = ?')
    .bind(data.visit_id).first<{ id: string }>();
  if (dup) return { error: 'duplicate' as const };
  // supports 仅接受服务端白名单标签（防任意字符串注入 AI prompt）
  const allowed = new Set<string>(FEEDBACK_SUPPORT_TAGS);
  const supports = [...new Set(data.supports)].filter((t) => allowed.has(t));
  const id = genId();
  await db.prepare(
    `INSERT INTO visit_feedback (id, visit_id, point_id, rating, supports, suggestion, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, data.visit_id, visit.point_id, data.rating,
    JSON.stringify(supports), data.suggestion, unixNow()).run();
  return { id };
}

export async function listVisitFeedback(
  db: D1Database,
  opts: { page?: number; page_size?: number } = {},
) {
  const { page = 1, page_size = 20 } = opts;
  const [paged, avg] = await Promise.all([
    paginate<VisitFeedback & { supports: string }>(db, {
      select: 'f.*, sp.name as point_name',
      from: 'FROM visit_feedback f LEFT JOIN service_points sp ON sp.id = f.point_id',
      countFrom: 'FROM visit_feedback f',
      order: 'ORDER BY f.created_at DESC', page, page_size,
    }),
    db.prepare('SELECT AVG(rating) as a FROM visit_feedback').first<{ a: number | null }>(),
  ]);
  return {
    items: paged.rows.map(r => ({ ...r, supports: parseJsonArray(r.supports, 'visit_feedback.supports') })),
    total: paged.total,
    avg_rating: avg?.a ? Math.round(avg.a * 10) / 10 : null,
    page, page_size,
  };
}

// ---------------------------------------------------------------------------
// AI 助手（知识库 / 动态上下文 / 口碑聚合 / 限流）
// ---------------------------------------------------------------------------

export type AiKnowledgeCategory = KnowledgeCategory;

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
  const { rows, total } = await paginate<RawKnowledge>(db, {
    select: '*', from: 'FROM ai_knowledge', countFrom: 'FROM ai_knowledge',
    wheres, bindings, order: 'ORDER BY updated_at DESC', page, page_size,
  });
  return { items: rows.map(deserializeKnowledge), total, page, page_size };
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
  const r = await db.prepare(`UPDATE ai_knowledge SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
  return { changes: r.meta.changes ?? 0 };
}

export async function deleteKnowledge(db: D1Database, id: string) {
  const r = await db.prepare('DELETE FROM ai_knowledge WHERE id = ?').bind(id).run();
  return { changes: r.meta.changes ?? 0 };
}

// 知识检索（注入 prompt 用）：tags/标题/正文命中计分，取 topN
export async function searchKnowledge(
  db: D1Database,
  query: string,
  opts: { topN?: number } = {},
) {
  const { topN = 3 } = opts;
  const rows = await db.prepare(
    'SELECT * FROM ai_knowledge WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 50',
  ).all<RawKnowledge>();
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

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

// crowdHint：近14天同星期同小时段的到店均值，与当前在店人数对比。
// 业务时间为 UTC+8，两侧都必须加 '+8 hours' 修正（否则整体偏移 8 小时、跨天时星期也错）。
function crowdHintFromAvg(inStore: number, capacity: number | null, n: number, days: number): string {
  if (capacity !== null && inStore >= capacity) return '名额已满';
  if (!days) return '暂无历史规律';
  const avg = n / days;
  if (avg <= 0) return inStore === 0 ? '暂无历史规律' : '当前较空';
  if (inStore >= avg * 1.3) return '高峰时段';
  if (inStore <= avg * 0.7) return '当前较空';
  return '与平时相近';
}

const CROWD_HINT_WHERE = `
  status IN ('in_store','completed')
  AND checked_in_at >= ?
  AND strftime('%w', checked_in_at, 'unixepoch', '+8 hours') = strftime('%w', 'now', '+8 hours')
  AND CAST(strftime('%H', checked_in_at, 'unixepoch', '+8 hours') AS INTEGER) = CAST(strftime('%H', 'now', '+8 hours') AS INTEGER)`;

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
  // 过期清理只在最外层跑一次（此前嵌套在 getOccupancy 内，一次 AI context 请求会触发多次全局 UPDATE 写放大）
  await expireStaleVisits(db);
  const rows = await db.prepare(
    `SELECT id, name, lat, lng, open_hours, services, admission FROM service_points
     WHERE status = 'open' ORDER BY updated_at DESC LIMIT 200`,
  ).all<{ id: string; name: string; lat: number; lng: number; open_hours: string; services: string; admission: string }>();
  const ranked = (rows.results ?? [])
    .map((r) => ({ row: r, distM: haversineMeters(lat, lng, r.lat, r.lng) }))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, limit);
  const ids = ranked.map(({ row }) => row.id);
  if (ids.length === 0) return [];

  // 选中的少数点位做两次 GROUP BY 聚合，替代此前每点 2+ 次查询
  const placeholders = ids.map(() => '?').join(',');
  const [occRows, hintRows] = await Promise.all([
    db.prepare(
      `SELECT point_id,
              SUM(CASE WHEN status = 'in_store' THEN 1 ELSE 0 END) as in_store,
              SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
       FROM visits WHERE point_id IN (${placeholders}) AND status IN ('in_store','reserved')
       GROUP BY point_id`,
    ).bind(...ids).all<{ point_id: string; in_store: number; reserved: number }>(),
    db.prepare(
      `SELECT point_id, COUNT(*) as n, COUNT(DISTINCT date(checked_in_at, 'unixepoch', '+8 hours')) as days
       FROM visits WHERE point_id IN (${placeholders}) AND ${CROWD_HINT_WHERE}
       GROUP BY point_id`,
    ).bind(...ids, unixNow() - 14 * 86400).all<{ point_id: string; n: number; days: number }>(),
  ]);
  const occMap = new Map((occRows.results ?? []).map((r) => [r.point_id, r]));
  const hintMap = new Map((hintRows.results ?? []).map((r) => [r.point_id, r]));

  return ranked.map(({ row, distM }) => {
    const occ = occMap.get(row.id);
    const hint = hintMap.get(row.id);
    let capacity: number | null = null;
    try {
      capacity = (JSON.parse(row.admission) as { capacity?: number }).capacity ?? null;
    } catch { /* 忽略坏数据 */ }
    let services: string[] = [];
    try { services = JSON.parse(row.services) as string[]; } catch { /* ignore */ }
    return {
      id: row.id,
      name: row.name,
      dist: formatDistance(distM),
      inStore: occ?.in_store ?? 0,
      openHours: row.open_hours,
      services,
      crowdHint: crowdHintFromAvg(occ?.in_store ?? 0, capacity, hint?.n ?? 0, hint?.days ?? 0),
    };
  });
}

// ---------- T2 口碑聚合（详情页"问小暖"注入 prompt） ----------

export interface PointFeedbackSummaryData {
  count: number;
  avgRating: number | null;
  goodRate: number | null;        // 4分及以上占比
  topSupports: Array<{ tag: string; n: number }>;
  recentSuggestions: string[];    // 最近3条非空建议
}

// 不可信用户内容进入 AI prompt 前的净化：剥离可提前闭合分隔块的角度括号、压平换行并限长
function sanitizeUntrustedText(raw: string, maxLen = 120): string {
  return raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
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
    // 只保留服务端白名单内的标签（历史脏数据不进 prompt）
    .filter(({ tag }) => (FEEDBACK_SUPPORT_TAGS as readonly string[]).includes(tag))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const recentSuggestions = list
    .map((r) => sanitizeUntrustedText(r.suggestion ?? ''))
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

// ---------- 限流（固定窗口 + 上一窗口加权，等效滑动窗口，消除交界处 2 倍突刺） ----------

export async function checkRateLimit(
  db: D1Database,
  key: string,
  opts: { limit?: number; windowSec?: number } = {},
): Promise<boolean> {
  const { limit = 20, windowSec = 60 } = opts;
  const now = unixNow();
  const curStart = Math.floor(now / windowSec) * windowSec;
  const prevStart = curStart - windowSec;
  const elapsed = (now - curStart) / windowSec;
  await db.prepare(
    `INSERT INTO ai_rate (ip, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1`,
  ).bind(key, curStart).run();
  const rows = await db.prepare(
    'SELECT window_start, count FROM ai_rate WHERE ip = ? AND window_start IN (?, ?)',
  ).bind(key, curStart, prevStart).all<{ window_start: number; count: number }>();
  // 顺手清理旧窗口：保留 7 天，确保 86400s 窗口的"上一窗口"行不被提前删掉
  // （否则每日限流退化为固定窗口，日界处可短时 2 倍）
  // 概率摊销：`now % 60 === 0` 只在整秒恰好落在 60 的倍数那一秒才触发，是"近似随机"
  // 而非均摊——请求时刻与秒对齐无关，多数窗口一次都不清理。gc.sql 是同窗口的周期兜底。
  if (Math.random() < 1 / 60) {
    await db.prepare('DELETE FROM ai_rate WHERE window_start < ?').bind(now - 7 * 86400).run();
  }
  const cur = rows.results?.find((r) => r.window_start === curStart)?.count ?? 0;
  const prev = rows.results?.find((r) => r.window_start === prevStart)?.count ?? 0;
  const effective = prev * (1 - elapsed) + cur;
  return effective <= limit;
}

// ---------------------------------------------------------------------------
// 上传台账：upload 签发的 key 记账，上报引用时校验"确为本 IP 近期上传"
// ---------------------------------------------------------------------------

export async function recordUpload(db: D1Database, key: string, ip: string) {
  await db.prepare(
    'INSERT OR IGNORE INTO uploads (key, ip, created_at) VALUES (?, ?, ?)',
  ).bind(key, ip, unixNow()).run();
}

// 返回 keys 中属于该 IP 且在 withinSec 内上传的子集
export async function filterOwnedUploads(
  db: D1Database,
  keys: string[],
  ip: string,
  withinSec = 24 * 3600,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT key FROM uploads WHERE key IN (${placeholders}) AND ip = ? AND created_at >= ?`,
  ).bind(...keys, ip, unixNow() - withinSec).all<{ key: string }>();
  return new Set((rows.results ?? []).map((r) => r.key));
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

// 查询码：10 位 Crockford base32（小写、去除 i/l/o/u 防误读），熵 ≈ 50 bit
// 10 位 Crockford base32 ≈ 50 bit 随机码：上报查询码与一次性入店码共用。
// 入店码校验用 `!==` 直接比：50 bit 熵 + 2 小时生命周期 + 每 IP 每分钟 10 次限流
// 已经把时序试探的空间压到没有，而原实现开头 `a.length !== b.length` 早退
// 本就先把长度泄漏出去，"恒定时间"名不副实。
function genRandomCode() {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % 32]).join('');
}

type RawPoint = ServicePoint & { services: string; admission: string };

// 分页查询的公共骨架：过滤拼 WHERE → 同一份 WHERE 计数 → LIMIT/OFFSET 取页。
// select/from 与 countFrom 分开写：列表要 JOIN 出人类可读的名称列，计数只认主表
// （一对多 JOIN 会让 COUNT 虚高）。所有 SQL 片段都是代码字面量，值一律走 bind。
interface PageQuery {
  select: string;
  from: string;
  countFrom: string;
  wheres?: string[];
  bindings?: unknown[];
  order: string;
  page: number;
  page_size: number;
}

async function paginate<Row>(db: D1Database, q: PageQuery) {
  const where = q.wheres?.length ? `WHERE ${q.wheres.join(' AND ')}` : '';
  const bindings = q.bindings ?? [];
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${q.select} ${q.from} ${where} ${q.order} LIMIT ? OFFSET ?`)
      .bind(...bindings, q.page_size, (q.page - 1) * q.page_size).all<Row>(),
    db.prepare(`SELECT COUNT(*) as n ${q.countFrom} ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return { rows: rows.results ?? [], total: count?.n ?? 0 };
}

// 坏数据（非法 JSON）不应把整条读路径打成 500：解析失败降级为空值并留痕
function parseJsonArray<T = string>(raw: string | null | undefined, ctx: string): T[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    console.error(`malformed JSON array in ${ctx}`);
    return [];
  }
}

function parseJsonObject<T>(raw: string | null | undefined, ctx: string): T {
  try {
    const v = JSON.parse(raw ?? '{}');
    return v && typeof v === 'object' ? (v as T) : ({} as T);
  } catch {
    console.error(`malformed JSON object in ${ctx}`);
    return {} as T;
  }
}

function deserializePoint(r: RawPoint): ServicePoint {
  // 显式挑字段而不是 `...r`：点位行里留着 created_by 这类管理员侧列，
  // 原样展开等于每页公开列表都下发一次管理员用户 id（P3-29）。
  // 从此新增列默认不下发，要下发必须在这里登记一次。
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    city: r.city,
    district: r.district,
    contact_phone: r.contact_phone,
    open_hours: r.open_hours,
    status: r.status,
    notes: r.notes,
    verified_at: r.verified_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    services: parseJsonArray(r.services, 'service_points.services'),
    admission: parseJsonObject<ServicePoint['admission']>(r.admission, 'service_points.admission'),
  };
}
