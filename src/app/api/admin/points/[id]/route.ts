import { getRequestContext } from '@cloudflare/next-on-pages';
import { getPoint, updatePoint, snapshotPoint } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

const UpdateSchema = z.object({
  name:          z.string().min(1).max(100).optional(),
  address:       z.string().min(1).max(200).optional(),
  lat:           z.number().optional(),
  lng:           z.number().optional(),
  city:          z.string().optional(),
  district:      z.string().optional(),
  contact_phone: z.string().optional(),
  open_hours:    z.string().optional(),
  status:        z.enum(['open', 'closed', 'temp_closed']).optional(),
  services:      z.array(z.string()).optional(),
  admission:     z.record(z.unknown()).optional(),
  notes:         z.string().optional(),
  qr_code_url:   z.string().optional(),
  verified_at:   z.number().nullable().optional(),
  verified_by:   z.string().nullable().optional(),
  change_summary: z.string().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const existing = await getPoint(env.DB, id);
  if (!existing) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败', details: parsed.error.flatten() }, { status: 422 });

  const { change_summary, ...data } = parsed.data;

  // Snapshot before update for full history
  await snapshotPoint(env.DB, id, auth.sub, change_summary ?? '管理员更新');
  await updatePoint(env.DB, id, data as Parameters<typeof updatePoint>[2]);

  return Response.json({ ok: true, data: { message: '更新成功' } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getRequestContext();
  const { id } = await params;
  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });
  return Response.json({ ok: true, data: point });
}
