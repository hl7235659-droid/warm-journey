import { getRequestContext } from '@cloudflare/next-on-pages';
import { listPoints } from '@/lib/db';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const sp = req.nextUrl.searchParams;

  const result = await listPoints(env.DB, {
    city:      sp.get('city') ?? undefined,
    status:    sp.get('status') ?? undefined,
    q:         sp.get('q') ?? undefined,
    service:   sp.get('service') ?? undefined,
    page:      Number(sp.get('page') ?? 1),
    page_size: Number(sp.get('page_size') ?? 20),
  });

  return Response.json({ ok: true, data: result });
}
