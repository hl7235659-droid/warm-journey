import { getRequestContext } from '@cloudflare/next-on-pages';
import { listPoints } from '@/lib/db';
import { pageParams } from '@/lib/http';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const sp = req.nextUrl.searchParams;
  const { page, page_size } = pageParams(sp, 20);

  const result = await listPoints(env.DB, {
    city:      sp.get('city') ?? undefined,
    status:    sp.get('status') ?? undefined,
    q:         sp.get('q') ?? undefined,
    service:   sp.get('service') ?? undefined,
    page,
    page_size,
  });

  return Response.json({ ok: true, data: result });
}
