import { getRequestContext } from '@cloudflare/next-on-pages';
import { checkoutVisit } from '@/lib/db';
import { readJson, isResponse, RiderTokenSchema } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

const CheckoutSchema = z.object({
  rider_token: RiderTokenSchema,
});

// 确认离店（骑手本人，rider_token 校验）：POST /api/visits/[id]/checkout
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;

  const parsed = await readJson(req, CheckoutSchema);
  if (isResponse(parsed)) return parsed;

  const result = await checkoutVisit(env.DB, id, parsed.rider_token);
  if (result.error === 'not_found') return Response.json({ ok: false, error: '记录不存在' }, { status: 404 });
  if (result.error === 'forbidden') return Response.json({ ok: false, error: '只能操作自己的进店记录' }, { status: 403 });
  if (result.error === 'invalid_state') return Response.json({ ok: false, error: '当前状态无法离店' }, { status: 409 });
  return Response.json({ ok: true, data: { visit: result.visit, already: 'already' in result } });
}
