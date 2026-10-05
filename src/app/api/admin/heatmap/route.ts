import { getHeatmapData } from '@/lib/db';
import { withAdmin } from '@/lib/http';

export const runtime = 'edge';

export const GET = withAdmin(async ({ env }) => {
  const data = await getHeatmapData(env.DB);
  return Response.json({ ok: true, data });
});
