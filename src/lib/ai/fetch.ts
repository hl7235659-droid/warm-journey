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

// 受信任的 OpenAI 兼容出站主机名：本站是公网可访问的转发点，
// 若允许任意 baseUrl，任何人可拿本站当跳板打第三方端点。
// 需要接入自建/中转域名时，用 Worker 环境变量 AI_ALLOWED_HOSTS="a.com,b.com" 追加。
const TRUSTED_HOSTS = new Set([
  'api.openai.com',
  'api.deepseek.com',
  'api.moonshot.cn',
  'open.bigmodel.cn',
  'dashscope.aliyuncs.com',
  'ark.cn-beijing.volces.com',
  'api.stepfun.com',
  'api.x.ai',
  'openrouter.ai',
  'api.groq.com',
  'api.siliconflow.cn',
  'generativelanguage.googleapis.com',
  'api.anthropic.com',
]);

// AI_ALLOWED_HOSTS 追加项的解析（trim / 小写 / 去空）。只在 validateBaseUrl 内部使用，
// 不导出：单测从 validateBaseUrl 这个真实入口验它的行为，比验一个内部函数更稳。
function allowedProviderHosts(extra: string): string[] {
  return extra.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

export function isTrustedProviderHost(hostname: string, extraHosts: string[] = []): boolean {
  const h = hostname.toLowerCase();
  if (extraHosts.includes(h)) return true;
  if (TRUSTED_HOSTS.has(h)) return true;
  // 子域放行（如 api.us-east.openrouter.ai），但必须是受信任项的结尾子域
  return [...TRUSTED_HOSTS, ...extraHosts].some((t) => h.endsWith(`.${t}`));
}

export function validateBaseUrl(raw: string, extraHostsCsv?: string): BaseUrlResult {
  const input = (raw || '').trim();
  if (!input) return { ok: false, url: '', error: '地址不能为空' };
  if (!/^https:\/\//i.test(input)) {
    return { ok: false, url: '', error: '地址必须以 https:// 开头（仅支持 HTTPS）' };
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
  if (!isTrustedProviderHost(u.hostname, allowedProviderHosts(extraHostsCsv ?? ''))) {
    return { ok: false, url: '', error: '该域名不在受信任的接口列表内，请改用主流 OpenAI 兼容服务或用 AI_ALLOWED_HOSTS 追加' };
  }
  // 去尾斜杠：https://api.x.com/v1/ → https://api.x.com/v1；根路径 → origin
  const path = u.pathname.replace(/\/+$/, '');
  return { ok: true, url: u.origin + path };
}

// OpenAI 兼容 chat/completions 地址
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

export interface ServerAiEnv {
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_ALLOWED_HOSTS?: string;
}

// 服务端兜底提供商（AI_* 三件套）。判据里带上 validateBaseUrl 是刻意的：
// 只看"三个变量都非空"会让徽章声称"已配置"，而 /api/ai/chat 实际因地址不合法
// 静默走本地降级——两处必须是同一份判据，徽章才不会撒谎。
// 返回 null 的三种情形：变量没配齐 / 地址不是 https / 域名不在白名单。
// 调用方只许把"可用/不可用"透出到界面，baseUrl 与 model 属服务器实现细节，不外泄。
export function resolveServerProvider(env: ServerAiEnv): { baseUrl: string; apiKey: string; model: string } | null {
  if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) return null;
  const v = validateBaseUrl(env.AI_BASE_URL, env.AI_ALLOWED_HOSTS);
  if (!v.ok) return null;
  return { baseUrl: v.url, apiKey: env.AI_API_KEY, model: env.AI_MODEL };
}
