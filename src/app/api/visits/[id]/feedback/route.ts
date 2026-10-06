import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createVisitFeedback, checkRateLimit } from '@/lib/db';
import { readJson, isResponse, getClientIp, RiderTokenSchema } from '@/lib/http';
import { z } from 'zod';

const FeedbackSchema = z.object({
  rider_token: RiderTokenSchema,
  rating: z.number().int().min(1).max(5),
  supports: z.array(z.string().max(20)).max(12).default([]),
  suggestion: z.string().max(500).default(''),
});

// 离店满意度反馈：POST /api/visits/[id]/feedback
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getCloudflareContext();
  const { id } = await params;

  // 防刷：每 IP 每分钟 10 次
  if (!(await checkRateLimit(env.DB, `fb:${getClientIp(req)}`, { limit: 10, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  const parsed = await readJson(req, FeedbackSchema);
  if (isResponse(parsed)) return parsed;

  // rider_token 必须与 visit 归属匹配，防止拿 visit id 冒名抢占评价
  const result = await createVisitFeedback(env.DB, {
    visit_id: id,
    rider_token: parsed.rider_token,
    rating: parsed.rating,
    supports: parsed.supports,
    suggestion: parsed.suggestion,
  });
  if (result.error === 'not_found') return Response.json({ ok: false, error: '记录不存在' }, { status: 404 });
  if (result.error === 'forbidden') return Response.json({ ok: false, error: '只能评价自己的进店记录' }, { status: 403 });
  if (result.error === 'invalid_state') return Response.json({ ok: false, error: '离店后才能评价' }, { status: 409 });
  // 离店后 7 天窗口（FEEDBACK_WINDOW），过期评分不再进均分与口碑聚合
  if (result.error === 'expired') return Response.json({ ok: false, error: '评价已过期，仅离店后 7 天内可提交' }, { status: 409 });
  if (result.error === 'duplicate') return Response.json({ ok: false, error: '已提交过评价' }, { status: 409 });
  return Response.json({ ok: true, data: { id: result.id } }, { status: 201 });
}
