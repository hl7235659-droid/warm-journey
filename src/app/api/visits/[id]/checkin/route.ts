import { getCloudflareContext } from '@opennextjs/cloudflare';
import { checkinVisit, checkRateLimit } from '@/lib/db';
import { readJson, isResponse, getClientIp } from '@/lib/http';
import { sanitizeVisit } from '@/lib/visit-sanitize';
import { z } from 'zod';

const CheckinSchema = z.object({
  code: z.string().trim().regex(/^[0-9a-z]{10}$/, '入店码格式不符'),
});

// 确认入店（店内人员扫骑手二维码后点确认）：POST /api/visits/[id]/checkin
// 凭证 = 二维码携带的一次性入店码：只转发/泄漏 visit id 无法远程确认入店。
// 响应绝不下发 rider_token / checkin_code / created_ip。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getCloudflareContext();

  // 防扫库：每 IP 每分钟 10 次
  if (!(await checkRateLimit(env.DB, `checkin:${getClientIp(req)}`, { limit: 10, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  const parsed = await readJson(req, CheckinSchema);
  // 与其他路由同口径：格式/校验错误原样返回 400/422，不压成"缺少入店码"的 403 误导排障。
  // 真正的凭证问题走下面 bad_code（业务码不匹配）分支。
  if (isResponse(parsed)) return parsed;

  const { id } = await params;
  const result = await checkinVisit(env.DB, id, parsed.code);
  if (result.error === 'not_found') return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  if (result.error === 'bad_code') {
    return Response.json({ ok: false, error: '入店码无效，请扫描骑手二维码的完整内容' }, { status: 403 });
  }
  if (result.error === 'invalid_state') {
    return Response.json({ ok: false, error: '该预约已失效（可能已过期或已取消），请重新预约' }, { status: 409 });
  }
  if (!result.visit) return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  return Response.json({ ok: true, data: { visit: sanitizeVisit(result.visit), already: 'already' in result } });
}
