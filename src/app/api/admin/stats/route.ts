import { getAdminStats } from '@/lib/db';
import { withAdmin } from '@/lib/http';

export const GET = withAdmin(async ({ env }) => {
  const stats = await getAdminStats(env.DB);
  return Response.json({ ok: true, data: stats });
});
