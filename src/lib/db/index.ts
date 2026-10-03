import type { ServicePoint, Report, WorkOrder, Inspection, AdminUser, PointHistory } from '@/lib/types';

export type D1Env = { DB: D1Database };

// ---------------------------------------------------------------------------
// Service Points
// ---------------------------------------------------------------------------

export async function listPoints(
  db: D1Database,
  opts: { city?: string; status?: string; q?: string; page?: number; page_size?: number } = {},
) {
  const { city, status, q, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];

  if (city) { wheres.push('city = ?'); bindings.push(city); }
  if (status) { wheres.push('status = ?'); bindings.push(status); }
  if (q) { wheres.push('(name LIKE ? OR address LIKE ?)'); bindings.push(`%${q}%`, `%${q}%`); }

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
  return db.prepare(
    `INSERT INTO reports (point_id, category, content, images, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(data.point_id, data.category, data.content, JSON.stringify(data.images), unixNow()).run();
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
// Helpers
// ---------------------------------------------------------------------------

function unixNow() { return Math.floor(Date.now() / 1000); }

type RawPoint = ServicePoint & { services: string; admission: string };
function deserializePoint(r: RawPoint): ServicePoint {
  return {
    ...r,
    services: JSON.parse(r.services) as string[],
    admission: JSON.parse(r.admission) as ServicePoint['admission'],
  };
}
