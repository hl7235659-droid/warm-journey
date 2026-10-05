import { listReports } from '@/lib/db';
import { withAdmin, pageParams } from '@/lib/http';

export const runtime = 'edge';

export const GET = withAdmin(async ({ req, env }) => {
  const sp = new URL(req.url).searchParams;
  const { page, page_size } = pageParams(sp, 20);
  const result = await listReports(env.DB, {
    status: sp.get('status') ?? undefined,
    page,
    page_size,
  });
  return Response.json({ ok: true, data: result });
});
