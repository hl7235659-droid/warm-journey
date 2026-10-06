import { getPoint, updatePoint, snapshotPoint } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, ROLES_CONTENT } from '@/lib/http';
import { PointUpdateSchema } from '@/lib/point-schema';

// PUT 校验由 PointUpdateSchema（= PointCreateSchema.partial()）提供，与 POST 同源

export const PUT = withAdmin<{ id: string }>(async ({ req, env, auth, params: { id } }) => {
  const existing = await getPoint(env.DB, id);
  if (!existing) return jsonErr('服务点不存在', 404);

  const parsed = await readJson(req, PointUpdateSchema);
  if (isResponse(parsed)) return parsed;

  // 先存变更前快照，再落新值（快照内容 = 更新前的行）
  await snapshotPoint(env.DB, id, auth.sub);
  await updatePoint(env.DB, id, parsed as Parameters<typeof updatePoint>[2]);

  return Response.json({ ok: true, data: { message: '更新成功' } });
}, { roles: ROLES_CONTENT, active: true });

export const GET = withAdmin<{ id: string }>(async ({ env, params: { id } }) => {
  const point = await getPoint(env.DB, id);
  if (!point) return jsonErr('服务点不存在', 404);
  return Response.json({ ok: true, data: point });
});
