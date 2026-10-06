import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getPoint, reserveVisit, checkRateLimit } from '@/lib/db';
import { readJson, isResponse, getClientIp, RiderTokenSchema } from '@/lib/http';
import { z } from 'zod';

const ReserveSchema = z.object({
  rider_token: RiderTokenSchema,
});

// 预约进店：POST /api/points/[id]/reserve
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getCloudflareContext();
  const { id } = await params;

  // 防脚本刷量占位：每 IP 每分钟 10 次（配合 DB 层同 IP 活跃预约数上限）
  const ip = getClientIp(req);
  if (!(await checkRateLimit(env.DB, `reserve:${ip}`, { limit: 10, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  const parsed = await readJson(req, ReserveSchema);
  if (isResponse(parsed)) return parsed;

  const point = await getPoint(env.DB, id);
  if (!point) return Response.json({ ok: false, error: '服务点不存在' }, { status: 404 });
  // 只有 open 可预约：temp_closed 只是"暂停"，此前被当成可预约漏放，名额被占用后无人接待
  if (point.status !== 'open') {
    const error = point.status === 'temp_closed' ? '该站点临时关闭，暂停预约' : '该站点已关闭，无法预约';
    return Response.json({ ok: false, error }, { status: 409 });
  }

  const result = await reserveVisit(env.DB, id, parsed.rider_token, ip);
  if ('ipLimited' in result && result.ipLimited) {
    return Response.json({ ok: false, error: '您名下的有效预约已达上限，请先完成或取消现有预约', code: 'IP_LIMIT' }, { status: 409 });
  }
  if ('full' in result && result.full) {
    return Response.json({ ok: false, error: '当前名额已满，请稍后再试', code: 'FULL' }, { status: 409 });
  }
  return Response.json({ ok: true, data: { visit: result.visit, created: result.created } }, { status: result.created ? 201 : 200 });
}
