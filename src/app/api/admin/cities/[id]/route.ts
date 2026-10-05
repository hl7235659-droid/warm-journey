import { getRequestContext } from '@cloudflare/next-on-pages';
import { updateCity } from '@/lib/db';
import { requireAdmin, requireRole } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

const UpdateSchema = z.object({
  name: z.string().min(1).max(20).optional(),
  center_lat: z.number().min(-90).max(90).optional(),
  center_lng: z.number().min(-180).max(180).optional(),
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin', 'admin']);
  if (forbidden) return forbidden;

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  await updateCity(env.DB, id, parsed.data);
  return Response.json({ ok: true, data: { message: '更新成功' } });
}
