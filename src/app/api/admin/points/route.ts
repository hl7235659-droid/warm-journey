import { getRequestContext } from '@cloudflare/next-on-pages';
import { listPoints, createPoint, snapshotPoint } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { z } from 'zod';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const result = await listPoints(env.DB, {
    city:      sp.get('city') ?? undefined,
    status:    sp.get('status') ?? undefined,
    q:         sp.get('q') ?? undefined,
    page:      Number(sp.get('page') ?? 1),
    page_size: Number(sp.get('page_size') ?? 50),
  });
  return Response.json({ ok: true, data: result });
}

const PointSchema = z.object({
  name:          z.string().min(1).max(100),
  address:       z.string().min(1).max(200),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  city:          z.string().default(''),
  district:      z.string().default(''),
  contact_phone: z.string().default(''),
  open_hours:    z.string().default('全天'),
  status:        z.enum(['open', 'closed', 'temp_closed']).default('open'),
  services:      z.array(z.string()).default([]),
  admission:     z.record(z.unknown()).default({}),
  notes:         z.string().default(''),
  qr_code_url:   z.string().default(''),
  verified_at:   z.number().nullable().default(null),
  verified_by:   z.string().nullable().default(null),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = PointSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败', details: parsed.error.flatten() }, { status: 422 });

  await createPoint(env.DB, { ...parsed.data, created_by: auth.sub,
    admission: parsed.data.admission as import('@/lib/types').AdmissionInfo });
  return Response.json({ ok: true, data: { message: '创建成功' } }, { status: 201 });
}
