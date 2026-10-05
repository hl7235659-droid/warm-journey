import { listVisits } from '@/lib/db';
import { withAdmin, pageParams } from '@/lib/http';

export const runtime = 'edge';

export const GET = withAdmin(async ({ req, env }) => {
  const sp = new URL(req.url).searchParams;
  const { page, page_size } = pageParams(sp, 50);
  const result = await listVisits(env.DB, {
    status: sp.get('status') ?? undefined,
    page,
    page_size,
  });
  return Response.json({ ok: true, data: result });
});
