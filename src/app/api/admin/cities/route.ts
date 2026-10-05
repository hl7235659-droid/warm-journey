import { getRequestContext } from '@cloudflare/next-on-pages';
import { listCities, createCity } from '@/lib/db';
import { requireAdmin, requireRole } from '@/lib/auth';
import { z } from 'zod';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const cities = await listCities(env.DB);
  return Response.json({ ok: true, data: cities });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(20),
  center_lat: z.number().min(-90).max(90),
  center_lng: z.number().min(-180).max(180),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;
  const forbidden = requireRole(auth, ['super_admin', 'admin']);
  if (forbidden) return forbidden;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  try {
    const id = await createCity(env.DB, parsed.data);
    return Response.json({ ok: true, data: { id } }, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: '城市已存在' }, { status: 409 });
  }
}
