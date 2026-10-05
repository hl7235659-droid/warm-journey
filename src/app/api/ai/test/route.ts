import { getRequestContext } from '@cloudflare/next-on-pages';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/db';
import { validateBaseUrl, fetchWithTimeout, chatCompletionsUrl } from '@/lib/ai/fetch';
import { requireAdmin } from '@/lib/auth';
import { getClientIp, jsonErr } from '@/lib/http';

export const runtime = 'edge';

const BodySchema = z.object({
  baseUrl: z.string().min(1).max(300),
  apiKey: z.string().max(300).default(''),
  model: z.string().min(1).max(120),
});

// POST /api/ai/test — 提供商连通性测试：发一条极小请求，要求模型只回四个字。
// 限流每 IP 每分钟 10 次；服务端环境变量 Key 仅对已登录管理员开放（防匿名白嫖服务器配额）。
export async function POST(req: Request) {
  const { env } = getRequestContext();
  const e = env as unknown as { JWT_SECRET?: string; AI_API_KEY?: string; AI_ALLOWED_HOSTS?: string };

  const ip = getClientIp(req);
  if (!(await checkRateLimit(env.DB, `aitest:${ip}`, { limit: 10, windowSec: 60 }))) {
    return jsonErr('测试过于频繁，请一分钟后再试', 429);
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonErr('请求格式错误', 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonErr('参数验证失败', 422);

  const v = validateBaseUrl(parsed.data.baseUrl, e.AI_ALLOWED_HOSTS);
  if (!v.ok) return jsonErr(`地址无效：${v.error}`, 422);

  // 请求体没带 key 时，仅管理员可用服务端配置测试"演示提供商"
  let apiKey = parsed.data.apiKey;
  if (!apiKey) {
    const auth = await requireAdmin(req, e);
    if (auth instanceof Response) return jsonErr('缺少 API Key（服务端密钥仅管理员可用）', 401);
    apiKey = e.AI_API_KEY || '';
  }
  if (!apiKey) return jsonErr('缺少 API Key（本机未填，服务器也未配置）', 422);

  try {
    const res = await fetchWithTimeout(chatCompletionsUrl(v.url), 20_000, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: parsed.data.model,
        stream: false,
        max_tokens: 20,
        messages: [{ role: 'user', content: '连通性测试，请只回复四个字：连接成功' }],
      }),
    });
    if (!res.ok) {
      console.error('ai test: provider http error, status:', res.status);
      const hint = res.status === 401 ? '（Key 无效或未授权）' : res.status === 404 ? '（路径不对？地址通常以 /v1 结尾）' : '';
      return Response.json({ ok: false, error: `接口返回 HTTP ${res.status}${hint}` }, { status: 200 });
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      const errMsg = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      console.error('ai test: provider empty reply:', errMsg?.slice(0, 200) ?? 'no error detail');
      return Response.json({ ok: false, error: '接口返回空回复' }, { status: 200 });
    }
    return Response.json({ ok: true, data: { reply: reply.slice(0, 50) } });
  } catch (e) {
    const err = e as { name?: string };
    console.error('ai test: fetch failed:', err?.name ?? 'unknown');
    const reason = err?.name === 'AbortError' ? '连接超时（20s）' : '网络错误，无法连接该地址';
    return Response.json({ ok: false, error: reason }, { status: 200 });
  }
}
