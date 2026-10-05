// 统一出站 fetch 封装 + baseUrl 安全校验（防 SSRF）
// 所有 AI 相关出站请求必须走这里。

export interface BaseUrlResult {
  ok: boolean;
  url: string;   // 规范化后的 baseUrl（无尾斜杠）
  error?: string;
}

// 内网 / 本机 / 保留地址一律拒绝（Edge 上无法做 DNS 反查，按主机名静态拦截）
const BLOCKED_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[::1\]$/,
  /^\[fe80:/i,
  /^\[fc/i,
  /^\[fd/i,
];

export function validateBaseUrl(raw: string): BaseUrlResult {
  const input = (raw || '').trim();
  if (!input) return { ok: false, url: '', error: '地址不能为空' };
  if (!/^https?:\/\//i.test(input)) {
    return { ok: false, url: '', error: '地址必须以 http:// 或 https:// 开头' };
  }
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, url: '', error: '地址格式无效' };
  }
  if (BLOCKED_HOST.some((re) => re.test(u.hostname))) {
    return { ok: false, url: '', error: '不支持内网或本机地址' };
  }
  // 去尾斜杠：https://api.x.com/v1/ → https://api.x.com/v1；根路径 → origin
  const path = u.pathname.replace(/\/+$/, '');
  return { ok: true, url: u.origin + path };
}

export async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// OpenAI 兼容 chat/completions 地址
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}
