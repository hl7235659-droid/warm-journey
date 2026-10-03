import { getRequestContext } from '@cloudflare/next-on-pages';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  return Response.json({ ok: true, data: { id: auth.sub, username: auth.username, role: auth.role } });
}
