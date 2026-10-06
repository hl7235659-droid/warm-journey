import type { WorkOrder } from '@/lib/types';
import { genId, paginate, unixNow } from './helpers';
import { getPoint } from './points';

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
