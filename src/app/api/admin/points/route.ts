import { listPoints, createPoint } from '@/lib/db';
import { withAdmin, readJson, isResponse, pageParams, ROLES_CONTENT } from '@/lib/http';
import { PointCreateSchema } from '@/lib/point-schema';
import type { AdmissionInfo } from '@/lib/types';

export const GET = withAdmin(async ({ req, env }) => {
  const sp = new URL(req.url).searchParams;
  const { page, page_size } = pageParams(sp, 50);
  const result = await listPoints(env.DB, {
    status:    sp.get('status') ?? undefined,
    q:         sp.get('q') ?? undefined,
    page,
    page_size,
  });
  return Response.json({ ok: true, data: result });
});

export const POST = withAdmin(async ({ req, env, auth }) => {
  const parsed = await readJson(req, PointCreateSchema);
  if (isResponse(parsed)) return parsed;

  await createPoint(env.DB, { ...parsed, created_by: auth.sub,
    admission: parsed.admission as AdmissionInfo });
  return Response.json({ ok: true, data: { message: '创建成功' } }, { status: 201 });
}, { roles: ROLES_CONTENT, active: true });
