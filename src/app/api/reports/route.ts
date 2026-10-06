import { getCloudflareContext } from '@opennextjs/cloudflare';
import { createReport, getPoint, maybeAutoCreateWorkOrder, checkRateLimit, filterOwnedUploads } from '@/lib/db';
import { readJson, isResponse, getClientIp } from '@/lib/http';
import { REPORT_CATEGORIES } from '@/lib/types';
import { IMAGE_KEY_RE } from '@/lib/upload';
import { z } from 'zod';

const ReportSchema = z.object({
  point_id: z.string().min(1),
  category: z.enum(REPORT_CATEGORIES),
  content:  z.string().min(5).max(500),
  // 只允许 /api/upload 签发的 key
  images:   z.array(z.string().regex(IMAGE_KEY_RE, '无效的图片 key')).max(3).default([]),
});

export async function POST(req: Request) {
  const { env } = getCloudflareContext();

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

  const { query_code: queryCode } = await createReport(env.DB, parsed);

  // 同一点位待核实上报达到阈值 → 自动开工单并关联（副作用保留，工单 id 不下发）
  await maybeAutoCreateWorkOrder(env.DB, parsed.point_id);

  // 响应只给免登录追踪需要的查询码：report_id 与内部工单 id 对本页零消费者，
  // 下发出去只是多给两个可枚举标识（成功提示文案本来也写死在上报页）。
  return Response.json({ ok: true, data: { query_code: queryCode } }, { status: 201 });
}
