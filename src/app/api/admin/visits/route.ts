import { getRequestContext } from '@cloudflare/next-on-pages';
import { listVisits } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const result = await listVisits(env.DB, {
    point_id: sp.get('point_id') ?? undefined,
    status:   sp.get('status') ?? undefined,
    page:     Number(sp.get('page') ?? 1),
    page_size: Number(sp.get('page_size') ?? 50),
  });
  return Response.json({ ok: true, data: result });
}
