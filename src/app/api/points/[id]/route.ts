import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getPoint } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getCloudflareContext();
  const { id } = await params;
  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });
  return Response.json({ ok: true, data: point });
}
