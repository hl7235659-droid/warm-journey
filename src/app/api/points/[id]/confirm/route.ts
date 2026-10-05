import { getRequestContext } from '@cloudflare/next-on-pages';
import { confirmPoint, getPoint, checkRateLimit } from '@/lib/db';
import { readJson, isResponse, getClientIp } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

const ConfirmSchema = z.object({
  rider_token: z.string().regex(/^[0-9a-f]{16,32}$/),
});

// 骑手一键确认「信息无误」：POST /api/points/[id]/confirm
// 同一设备（rider_token）30 天内对同一点位只计一次，防循环刷量。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;

  if (!(await checkRateLimit(env.DB, `confirm:${getClientIp(req)}`, { limit: 10, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  const parsed = await readJson(req, ConfirmSchema);
  if (isResponse(parsed)) return parsed;

  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  const count = await confirmPoint(env.DB, id, parsed.rider_token);
  return Response.json({ ok: true, data: { confirm_count: count } });
}
