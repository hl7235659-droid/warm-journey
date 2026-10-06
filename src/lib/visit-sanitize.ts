import type { Visit } from './types';

// 公开响应的 visit 形状：内部字段一律剥离。
export type PublicVisit =
  Omit<Visit, 'rider_token' | 'created_ip' | 'checkin_code'>
  & Partial<Pick<Visit, 'rider_token' | 'checkin_code'>>;

// 与管理端列表（db/index.ts 的 maskToken）同口径：看得出是哪个骑手，拿不到钥匙。
function maskRiderToken(token: string) {
  return token.length > 6 ? `${token.slice(0, 6)}…` : '…';
}

// visit 出口的唯一脱敏口。rider_token 是能操作他人预约的凭证，created_ip / checkin_code
// 是反滥用内部字段，任何公开响应都不得原样下发。
// 两个例外都必须发生在"本人/店内人员已持有凭证"的语境里：
// - keepCode：本人进行中预约保留 checkin_code，VisitCard 靠它生成入店二维码；
// - maskToken：入店确认页要显示骑手标识，只给前 6 位。
export function sanitizeVisit(
  visit: Visit,
  opts: { keepCode?: boolean; maskToken?: boolean } = {},
): PublicVisit {
  const { rider_token, created_ip, checkin_code, ...rest } = visit;
  const out: PublicVisit = { ...rest };
  if (opts.keepCode && checkin_code) out.checkin_code = checkin_code;
  if (opts.maskToken && rider_token !== undefined) out.rider_token = maskRiderToken(rider_token);
  return out;
}
