import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getReportByCode, checkRateLimit } from '@/lib/db';
import { getClientIp } from '@/lib/http';

// 免登录上报进度查询：GET /api/reports/status?code=<查询码>
// 查询码为独立高熵字段（10 位 base32）；响应不含 content 全文，防批量枚举套取他人上报内容。
export async function GET(req: Request) {
  const { env } = getCloudflareContext();

  const ip = getClientIp(req);
  if (!(await checkRateLimit(env.DB, `rstatus:${ip}`, { limit: 10, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '查询过于频繁，请稍后再试' }, { status: 429 });
  }

  const code = (new URL(req.url).searchParams.get('code') ?? '').trim().toLowerCase();

  if (!code) {
    return Response.json({ ok: false, error: '请输入查询码' }, { status: 400 });
  }

  const report = await getReportByCode(env.DB, code);
  if (!report) {
    return Response.json({ ok: false, error: '未找到该上报记录，请核对查询码' }, { status: 404 });
  }

  return Response.json({ ok: true, data: report });
}
