import { listInspections, createInspection, getPoint } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, pageParams } from '@/lib/http';
import { ADMIN_ROLES } from '@/lib/types';
import { IMAGE_KEY_RE } from '@/lib/upload';
import { z } from 'zod';

export const GET = withAdmin(async ({ req, env }) => {
  const sp = new URL(req.url).searchParams;
  const { page, page_size } = pageParams(sp, 20);
  const result = await listInspections(env.DB, { page, page_size });
  return Response.json({ ok: true, data: result });
});

const CreateSchema = z.object({
  point_id:   z.string().min(1),
  result:     z.enum(['pass', 'fail', 'partial']),
  images:     z.array(z.string().regex(IMAGE_KEY_RE, '无效的图片 key')).max(8).default([]),
  notes:      z.string().max(2000).default(''),
  inspected_at: z.number().optional(),
});

export const POST = withAdmin(async ({ req, env, auth }) => {
  const parsed = await readJson(req, CreateSchema);
  if (isResponse(parsed)) return parsed;

  // point_id 必须真实存在，防孤儿巡检记录
  const point = await getPoint(env.DB, parsed.point_id);
  if (!point) return jsonErr('服务点不存在', 404);

  await createInspection(env.DB, {
    ...parsed,
    inspector_id: auth.sub,
    inspected_at: parsed.inspected_at ?? Math.floor(Date.now() / 1000),
  });
  return Response.json({ ok: true, data: { message: '巡检记录已提交' } }, { status: 201 });
}, { roles: ADMIN_ROLES, active: true });
