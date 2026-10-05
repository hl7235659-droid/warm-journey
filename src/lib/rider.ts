// 骑手匿名标识：localStorage 生成一次，全程免登录
const KEY = 'wj_rider_token';

export function getRiderToken(): string {
  try {
    let token = localStorage.getItem(KEY);
    if (token && /^[0-9a-f]{16,32}$/.test(token)) return token;
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, token);
    return token;
  } catch {
    // localStorage 不可用（隐私模式等）：退化为会话内随机 token
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
  }
}
