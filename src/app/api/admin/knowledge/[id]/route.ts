import { updateKnowledge, deleteKnowledge } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, assertId, ROLES_CONTENT } from '@/lib/http';
import { KNOWLEDGE_CATEGORIES } from '@/lib/types';
import { z } from 'zod';

const UpdateSchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  title: z.string().min(1).max(60).optional(),
  content: z.string().min(1).max(2000).optional(),
  tags: z.array(z.string().min(1).max(20)).max(10).optional(),
  enabled: z.boolean().optional(),
});

export const PUT = withAdmin<{ id: string }>(async ({ req, env, params: { id } }) => {
  const bad = assertId(id);
  if (bad) return bad;

  const parsed = await readJson(req, UpdateSchema);
  if (isResponse(parsed)) return parsed;
  if (Object.keys(parsed).length === 0) return jsonErr('参数验证失败', 422);

  const { changes } = await updateKnowledge(env.DB, id, parsed);
  if (changes === 0) return jsonErr('条目不存在', 404);
  return Response.json({ ok: true });
}, { roles: ROLES_CONTENT, active: true });

export const DELETE = withAdmin<{ id: string }>(async ({ env, params: { id } }) => {
  const bad = assertId(id);
  if (bad) return bad;

  const { changes } = await deleteKnowledge(env.DB, id);
  if (changes === 0) return jsonErr('条目不存在', 404);
  return Response.json({ ok: true });
}, { roles: ROLES_CONTENT, active: true });
