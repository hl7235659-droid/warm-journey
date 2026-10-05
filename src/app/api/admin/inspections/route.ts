import { listInspections, createInspection, getPoint } from '@/lib/db';
import { withAdmin, readJson, isResponse, pageParams } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

export const GET = withAdmin(async ({ req, env }) => {
  const sp = new URL(req.url).searchParams;
  const { page, page_size } = pageParams(sp, 20);
  const result = await listInspections(env.DB, {
    point_id: sp.get('point_id') ?? undefined,
    page,
    page_size,
  });
  return Response.json({ ok: true, data: result });
});

const CreateSchema = z.object({
  point_id:   z.string().min(1),
  result:     z.enum(['pass', 'fail', 'partial']),
  findings:   z.array(z.string().max(200)).max(20).default([]),
  images:     z.array(z.string().max(120)).max(8).default([]),
  notes:      z.string().max(2000).default(''),
  inspected_at: z.number().optional(),
});

export const POST = withAdmin(async ({ req, env, auth }) => {
  const parsed = await readJson(req, CreateSchema);
  if (isResponse(parsed)) return parsed;

  // point_id 必须真实存在，防孤儿巡检记录
  const point = await getPoint(env.DB, parsed.point_id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  await createInspection(env.DB, {
    ...parsed,
    inspector_id: auth.sub,
    inspected_at: parsed.inspected_at ?? Math.floor(Date.now() / 1000),
  });
  return Response.json({ ok: true, data: { message: '巡检记录已提交' } }, { status: 201 });
}, { roles: ['super_admin', 'admin', 'inspector'] });
