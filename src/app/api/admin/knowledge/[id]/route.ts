import { getRequestContext } from '@cloudflare/next-on-pages';
import { updateKnowledge, deleteKnowledge } from '@/lib/db';
import { requireAdmin, requireRole } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

const UpdateSchema = z.object({
  category: z.enum(['rights', 'channel', 'faq', 'notice']).optional(),
  title: z.string().min(1).max(60).optional(),
  content: z.string().min(1).max(2000).optional(),
  tags: z.array(z.string().min(1).max(20)).max(10).optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin', 'admin']);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!/^[a-z0-9]{4,32}$/.test(id)) {
    return Response.json({ ok: false, error: 'id 格式无效' }, { status: 422 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });
  }

  await updateKnowledge(env.DB, id, parsed.data);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin', 'admin']);
  if (forbidden) return forbidden;

  const { id } = await params;
  if (!/^[a-z0-9]{4,32}$/.test(id)) {
    return Response.json({ ok: false, error: 'id 格式无效' }, { status: 422 });
  }

  await deleteKnowledge(env.DB, id);
  return Response.json({ ok: true });
}
