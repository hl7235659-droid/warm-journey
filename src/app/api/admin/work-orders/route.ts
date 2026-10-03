import { getRequestContext } from '@cloudflare/next-on-pages';
import { listWorkOrders, createWorkOrder, updateReport } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { z } from 'zod';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  const sp = req.nextUrl.searchParams;
  const result = await listWorkOrders(env.DB, {
    status:   sp.get('status') ?? undefined,
    point_id: sp.get('point_id') ?? undefined,
    page:     Number(sp.get('page') ?? 1),
    page_size: Number(sp.get('page_size') ?? 20),
  });
  return Response.json({ ok: true, data: result });
}

const CreateSchema = z.object({
  title:       z.string().min(1).max(100),
  description: z.string().default(''),
  point_id:    z.string().nullable().default(null),
  report_id:   z.string().nullable().default(null),
  assigned_to: z.string().nullable().default(null),
  priority:    z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const auth = await requireAdmin(req, env as { JWT_SECRET?: string });
  if (auth instanceof Response) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  const result = await createWorkOrder(env.DB, {
    ...parsed.data,
    status: 'open',
    resolution_note: '',
    created_by: auth.sub,
  });

  // link the source report → this work order
  if (parsed.data.report_id && result.meta?.last_row_id) {
    const newId = String(result.meta.last_row_id);
    await updateReport(env.DB, parsed.data.report_id, { status: 'processing', work_order_id: newId });
  }

  return Response.json({ ok: true, data: { message: '工单已创建' } }, { status: 201 });
}
