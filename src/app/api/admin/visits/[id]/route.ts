import { checkoutVisit } from '@/lib/db';
import { withAdmin, jsonErr, ROLES_CONTENT } from '@/lib/http';
import { sanitizeVisit } from '@/lib/visit-sanitize';

// 管理端强制离店：影响骑手占用状态，限管理员及以上。
// 该 PUT 只有"强制离店"一种语义，故无 body——此前 `action: z.literal('force_checkout')`
// 的单值判别式只会让调用方硬编码一个没有第二种取值的字段。
export const PUT = withAdmin<{ id: string }>(async ({ env, params: { id } }) => {
  const result = await checkoutVisit(env.DB, id); // 无 rider_token = 管理端强制
  if (result.error === 'not_found') return jsonErr('记录不存在', 404);
  if (result.error === 'invalid_state') return jsonErr('该记录不在在店状态', 409);
  // 与管理端列表同口径：rider_token 是能操作他人预约的钥匙，特权面也只给前 6 位；
  // created_ip / checkin_code 属反滥用内部字段，一律不下发（调用方只读 j.ok）。
  return Response.json({
    ok: true,
    data: { visit: result.visit ? sanitizeVisit(result.visit, { maskToken: true }) : null },
  });
}, { roles: ROLES_CONTENT, active: true });
