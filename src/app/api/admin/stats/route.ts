import { getRequestContext } from '@cloudflare/next-on-pages';
import { getAdminStats } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const stats = await getAdminStats(env.DB);
  return Response.json({ ok: true, data: stats });
}
