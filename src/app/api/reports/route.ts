import { getRequestContext } from '@cloudflare/next-on-pages';
import { createReport, getPoint, maybeAutoCreateWorkOrder, checkRateLimit, filterOwnedUploads } from '@/lib/db';
import { readJson, isResponse, getClientIp } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

const ReportSchema = z.object({
  point_id: z.string().min(1),
  category: z.enum(['closed', 'info_wrong', 'facility', 'safety', 'other']),
  content:  z.string().min(5).max(500),
  // 只允许 /api/upload 签发的 key
  images:   z.array(z.string().regex(/^img\/\d{4}-\d{2}\/[0-9a-f]{16}\.(jpg|png|webp|gif)$/)).max(3).default([]),
});

export async function POST(req: Request) {
  const { env } = getRequestContext();

  // 上报频控：每 IP 每小时 20 条
  const ip = getClientIp(req);
  if (!(await checkRateLimit(env.DB, `report:${ip}`, { limit: 20, windowSec: 3600 }))) {
    return Response.json({ ok: false, error: '提交过于频繁，请稍后再试' }, { status: 429 });
  }

  const parsed = await readJson(req, ReportSchema);
  if (isResponse(parsed)) return parsed;

  const point = await getPoint(env.DB, parsed.point_id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });

  // images 必须全部属于本 IP 近 24 小时内上传的台账记录（防引用他人/任意 key）
  if (parsed.images.length > 0) {
    const owned = await filterOwnedUploads(env.DB, parsed.images, ip);
    const missing = parsed.images.filter((k) => !owned.has(k));
    if (missing.length > 0) {
      return Response.json({ ok: false, error: '存在无效或非本人上传的图片，请重新上传' }, { status: 422 });
    }
  }

  const { id: reportId, query_code: queryCode } = await createReport(env.DB, parsed);

  // 同一点位待核实上报达到阈值 → 自动开工单并关联
  const autoOrderId = await maybeAutoCreateWorkOrder(env.DB, parsed.point_id);

  return Response.json({
    ok: true,
    data: { message: '上报成功，感谢您的反馈', report_id: reportId, query_code: queryCode, auto_order_id: autoOrderId },
  }, { status: 201 });
}
