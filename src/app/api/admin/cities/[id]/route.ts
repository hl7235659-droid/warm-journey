import { updateCity } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, ROLES_CONTENT } from '@/lib/http';
import { z } from 'zod';

const UpdateSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  center_lat: z.number().min(-90).max(90).optional(),
  center_lng: z.number().min(-180).max(180).optional(),
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const PUT = withAdmin<{ id: string }>(async ({ req, env, params: { id } }) => {
  const parsed = await readJson(req, UpdateSchema);
  if (isResponse(parsed)) return parsed;
  // 空 body 时 UPDATE 影响 0 行，不能误报「城市不存在」
  if (Object.keys(parsed).length === 0) return jsonErr('没有需要更新的字段', 422);

  const { changes } = await updateCity(env.DB, id, parsed);
  if (changes === 0) return jsonErr('城市不存在', 404);
  return Response.json({ ok: true, data: { message: '更新成功' } });
}, { roles: ROLES_CONTENT });
