import { getRequestContext } from '@cloudflare/next-on-pages';
import { getReportByCode } from '@/lib/db';

export const runtime = 'edge';

// 免登录上报进度查询：GET /api/reports/status?code=<查询码（report id 前缀，≥6 位）>
export async function GET(req: Request) {
  const { env } = getRequestContext();
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
