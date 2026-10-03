import { getRequestContext } from '@cloudflare/next-on-pages';
import { listInspections, createInspection } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { z } from 'zod';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const result = await listInspections(env.DB, {
    point_id: sp.get('point_id') ?? undefined,
    page:     Number(sp.get('page') ?? 1),
    page_size: Number(sp.get('page_size') ?? 20),
  });
  return Response.json({ ok: true, data: result });
}

const CreateSchema = z.object({
  point_id:   z.string().min(1),
  result:     z.enum(['pass', 'fail', 'partial']),
  findings:   z.array(z.string()).default([]),
  images:     z.array(z.string()).max(8).default([]),
  notes:      z.string().default(''),
  inspected_at: z.number().optional(),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  await createInspection(env.DB, {
    ...parsed.data,
    inspector_id: auth.sub,
    inspected_at: parsed.data.inspected_at ?? Math.floor(Date.now() / 1000),
  });
  return Response.json({ ok: true, data: { message: '巡检记录已提交' } }, { status: 201 });
}
