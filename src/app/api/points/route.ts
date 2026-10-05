import { getRequestContext } from '@cloudflare/next-on-pages';
import { listPoints, getPointStats } from '@/lib/db';
import { pageParams } from '@/lib/http';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const sp = req.nextUrl.searchParams;
  const { page, page_size } = pageParams(sp, 20);

  const [result, meta] = await Promise.all([
    listPoints(env.DB, {
      city:      sp.get('city') ?? undefined,
      status:    sp.get('status') ?? undefined,
      q:         sp.get('q') ?? undefined,
      service:   sp.get('service') ?? undefined,
      page,
      page_size,
    }),
    getPointStats(env.DB),
  ]);

  // meta 是与筛选/分页无关的全量口径（首页圆章用），data.total 是本次筛选命中数（列表计数用）
  return Response.json({ ok: true, data: { ...result, meta } });
}
