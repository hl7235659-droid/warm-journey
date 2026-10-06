import { shanghaiDayStart, unixNow } from './helpers';
import { expireStaleVisits } from './visits';

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
