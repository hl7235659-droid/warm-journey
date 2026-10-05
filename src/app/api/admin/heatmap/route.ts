import { getRequestContext } from '@cloudflare/next-on-pages';
import { getHeatmapData } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const data = await getHeatmapData(env.DB);
  return Response.json({ ok: true, data });
}
