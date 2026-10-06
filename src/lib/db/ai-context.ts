import { FEEDBACK_SUPPORT_TAGS } from '@/lib/types';
import { haversineMeters } from '@/lib/geo';
import { unixNow } from './helpers';
import { expireStaleVisits } from './visits';

// ---------- 动态上下文：附近开放站点 + 在店人数 + crowdHint ----------

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
