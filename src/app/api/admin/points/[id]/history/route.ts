import { listPointHistory } from '@/lib/db';
import { withAdmin } from '@/lib/http';

export const runtime = 'edge';

export const GET = withAdmin<{ id: string }>(async ({ env, params: { id } }) => {
  const history = await listPointHistory(env.DB, id);
  return Response.json({ ok: true, data: history });
});
