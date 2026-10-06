import type { VisitFeedback } from '@/lib/types';
import { FEEDBACK_SUPPORT_TAGS } from '@/lib/types';
import { genId, paginate, parseJsonArray, unixNow } from './helpers';
import { getVisit } from './visits';

// ---------------------------------------------------------------------------
// Visit Feedback（离店满意度）
// ---------------------------------------------------------------------------

// 评价窗口：离店（含 4h 兜底自动离店）后 7 天内可评价。窗口存在的理由是这批评分
// 会直接进 AI 周报、口碑摘要与均分，半年前的 visit 被补投会让"近期口碑"失真。
export const FEEDBACK_WINDOW = 7 * 24 * 3600;

export async function createVisitFeedback(
  db: D1Database,
  data: { visit_id: string; rider_token: string; rating: number; supports: string[]; suggestion: string },
) {
  const visit = await getVisit(db, data.visit_id);
  if (!visit) return { error: 'not_found' as const };
  // 只有本人（rider_token 匹配）才能评价，防止拿 visit id 冒名抢占
  if (visit.rider_token !== data.rider_token) return { error: 'forbidden' as const };
  if (visit.status !== 'completed') return { error: 'invalid_state' as const };
  // checked_out_at 为空说明这条 completed 没有离店时刻（异常数据），不给无限窗口
  if (!visit.checked_out_at || unixNow() - visit.checked_out_at > FEEDBACK_WINDOW) {
    return { error: 'expired' as const };
  }
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
