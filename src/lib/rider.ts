// 骑手匿名标识：localStorage 生成一次，全程免登录
import { toHex } from '@/lib/bytes';

const KEY = 'wj_rider_token';

export function getRiderToken(): string {
  try {
    let token = localStorage.getItem(KEY);
    if (token && /^[0-9a-f]{16,32}$/.test(token)) return token;
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    token = toHex(bytes);
    localStorage.setItem(KEY, token);
    return token;
  } catch {
    // localStorage 不可用（隐私模式等）：退化为会话内随机 token
    return toHex(crypto.getRandomValues(new Uint8Array(8)));
  }
}
