import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getVisit, checkRateLimit } from '@/lib/db';
import { getClientIp } from '@/lib/http';
import { sanitizeVisit } from '@/lib/visit-sanitize';

// 查询 visit（入店确认页用，id 即凭证）：GET /api/visits/[id]
//
// 设计取舍（L12 固化，勿当漏洞"修复"）：此处不做会话鉴权，凭证就是 URL 里的
// visit id——店家扫的入店二维码本来就是 /checkin/{id}?c={码}，id 在产品上就是
// 要出示给对方的。其安全性靠三重缓解兜底，缺一不可，请勿单独删除其中一层：
//   1. id 不可枚举：genId 取 crypto.getRandomValues 8 字节（64bit）随机，
//      无法像自增 id 那样被批量遍历；
//   2. 限流兜底：下方 20 次/分/IP，把慢速猜解压到不经济；
//   3. 响应脱敏：sanitizeVisit 剥离 rider_token / created_ip / checkin_code
//      （rider_token 只留前 6 位供辨认），拿到响应也冒充不了骑手。
// 另外"改状态"还有第二因子：POST checkin 必须对上二维码携带的一次性入店码
// （见 checkin/route.ts，10 次/分/IP），仅凭 id 无法远程确认入店。
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { env } = getCloudflareContext();

  // 与 checkin 同源凭证：同样限流，防止批量探测 visit id
  if (!(await checkRateLimit(env.DB, `visit:${getClientIp(req)}`, { limit: 20, windowSec: 60 }))) {
    return Response.json({ ok: false, error: '查询过于频繁，请稍后再试' }, { status: 429 });
  }

  const { id } = await params;
  const visit = await getVisit(env.DB, id);
  if (!visit) return Response.json({ ok: false, error: '预约不存在' }, { status: 404 });
  // occupancy 不在这里：两个真实消费者（入店确认页、AI route action）都只读 .visit，
  // 每次为它们多跑 5 条 D1 语句换不来一个读取方。需要占用数字的骑手详情页
  // 走 /api/visits/active（P2-20）。
  // maskToken = 确认页要辨认"是哪个骑手"，只给前 6 位；入店码与 IP 一律不下发，
  // 否则旁观者可凭响应远程代确认入店。
  return Response.json({ ok: true, data: { visit: sanitizeVisit(visit, { maskToken: true }) } });
}
