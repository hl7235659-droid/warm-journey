import { updateKnowledge, deleteKnowledge } from '@/lib/db';
import { withAdmin, readJson, isResponse } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

const UpdateSchema = z.object({
  category: z.enum(['rights', 'channel', 'faq', 'notice']).optional(),
  title: z.string().min(1).max(60).optional(),
  content: z.string().min(1).max(2000).optional(),
  tags: z.array(z.string().min(1).max(20)).max(10).optional(),
  enabled: z.boolean().optional(),
});

export const PUT = withAdmin<{ id: string }>(async ({ req, env, params: { id } }) => {
  if (!/^[a-z0-9]{4,32}$/.test(id)) {
    return Response.json({ ok: false, error: 'id 格式无效' }, { status: 422 });
  }

  const parsed = await readJson(req, UpdateSchema);
  if (isResponse(parsed)) return parsed;
  if (Object.keys(parsed).length === 0) {
    return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });
  }

  const { changes } = await updateKnowledge(env.DB, id, parsed);
  if (changes === 0) return Response.json({ ok: false, error: '条目不存在' }, { status: 404 });
  return Response.json({ ok: true });
}, { roles: ['super_admin', 'admin'] });

export const DELETE = withAdmin<{ id: string }>(async ({ env, params: { id } }) => {
  if (!/^[a-z0-9]{4,32}$/.test(id)) {
    return Response.json({ ok: false, error: 'id 格式无效' }, { status: 422 });
  }

  const { changes } = await deleteKnowledge(env.DB, id);
  if (changes === 0) return Response.json({ ok: false, error: '条目不存在' }, { status: 404 });
  return Response.json({ ok: true });
}, { roles: ['super_admin', 'admin'] });
