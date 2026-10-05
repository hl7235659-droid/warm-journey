import { getRequestContext } from '@cloudflare/next-on-pages';
import { createVisitFeedback } from '@/lib/db';
import { z } from 'zod';

export const runtime = 'edge';

const FeedbackSchema = z.object({
  rider_token: z.string().regex(/^[0-9a-f]{16,32}$/),
  rating: z.number().int().min(1).max(5),
  supports: z.array(z.string().max(20)).max(12).default([]),
  suggestion: z.string().max(500).default(''),
});

// 离店满意度反馈：POST /api/visits/[id]/feedback
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  const result = await createVisitFeedback(env.DB, {
    visit_id: id,
    rating: parsed.data.rating,
    supports: parsed.data.supports,
    suggestion: parsed.data.suggestion,
  });
  if (result.error === 'not_found') return Response.json({ ok: false, error: '记录不存在' }, { status: 404 });
  if (result.error === 'invalid_state') return Response.json({ ok: false, error: '离店后才能评价' }, { status: 409 });
  if (result.error === 'duplicate') return Response.json({ ok: false, error: '已提交过评价' }, { status: 409 });
  return Response.json({ ok: true, data: { id: result.id } }, { status: 201 });
}
