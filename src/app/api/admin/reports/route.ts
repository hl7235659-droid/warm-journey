import { getRequestContext } from '@cloudflare/next-on-pages';
import { listReports } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const result = await listReports(env.DB, {
    status:   sp.get('status') ?? undefined,
    point_id: sp.get('point_id') ?? undefined,
    page:     Number(sp.get('page') ?? 1),
    page_size: Number(sp.get('page_size') ?? 20),
  });
  return Response.json({ ok: true, data: result });
}
