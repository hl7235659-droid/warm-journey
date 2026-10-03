import { getRequestContext } from '@cloudflare/next-on-pages';
import { listPointHistory } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const history = await listPointHistory(env.DB, id);
  return Response.json({ ok: true, data: history });
}
