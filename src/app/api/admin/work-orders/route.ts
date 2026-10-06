import { listWorkOrders, createWorkOrder, updateReport } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, pageParams, ROLES_CONTENT } from '@/lib/http';
import { z } from 'zod';

export const GET = withAdmin(async ({ req, env }) => {
  const sp = new URL(req.url).searchParams;
  const { page, page_size } = pageParams(sp, 20);
  const result = await listWorkOrders(env.DB, {
    status: sp.get('status') ?? undefined,
    page,
    page_size,
  });
  return Response.json({ ok: true, data: result });
});

const CreateWorkOrderSchema = z.object({
  title:       z.string().min(1).max(100),
  description: z.string().default(''),
  point_id:    z.string().nullable().default(null),
  report_id:   z.string().nullable().default(null),
  priority:    z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

export const POST = withAdmin(async ({ req, env, auth }) => {
  const parsed = await readJson(req, CreateWorkOrderSchema);
  if (isResponse(parsed)) return parsed;

  // createWorkOrder 显式生成 TEXT 主键并返回 id（last_row_id 是数字 rowid，与之无关）
  let newId: string;
  try {
    newId = await createWorkOrder(env.DB, {
      ...parsed,
      status: 'open',
      resolution_note: '',
      created_by: auth.sub,
    });
  } catch (e) {
    // idx_orders_report：同一上报只允许一张工单，重复建单应报业务冲突而非 500
    if (((e as { message?: string })?.message ?? '').includes('UNIQUE')) {
      return jsonErr('该上报已有关联工单', 409);
    }
    throw e;
  }

  // link the source report → this work order
  if (parsed.report_id) {
    await updateReport(env.DB, parsed.report_id, { status: 'processing', work_order_id: newId });
  }

  return Response.json({ ok: true, data: { message: '工单已创建', id: newId } }, { status: 201 });
}, { roles: ROLES_CONTENT, active: true });
