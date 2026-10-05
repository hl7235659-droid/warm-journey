import { getRequestContext } from '@cloudflare/next-on-pages';
import { confirmPoint, getPoint } from '@/lib/db';

export const runtime = 'edge';

// 骑手一键确认「信息无误」：POST /api/points/[id]/confirm
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;

  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  const count = await confirmPoint(env.DB, id);
  return Response.json({ ok: true, data: { confirm_count: count } });
}
