import { getRequestContext } from '@cloudflare/next-on-pages';
import { z } from 'zod';
import { validateBaseUrl, fetchWithTimeout, chatCompletionsUrl } from '@/lib/ai/fetch';

export const runtime = 'edge';

const BodySchema = z.object({
  baseUrl: z.string().min(1).max(300),
  apiKey: z.string().max(300).default(''),
  model: z.string().min(1).max(120),
});

// POST /api/ai/test — 提供商连通性测试：发一条极小请求，要求模型只回四个字
export async function POST(req: Request) {
  const { env } = getRequestContext();

  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });

  const v = validateBaseUrl(parsed.data.baseUrl);
  if (!v.ok) return Response.json({ ok: false, error: `地址无效：${v.error}` }, { status: 422 });

  // 环境变量兜底：请求体没带 key 时用服务端配置（用于"演示提供商"测试）
  const apiKey = parsed.data.apiKey || env.AI_API_KEY || '';
  if (!apiKey) return Response.json({ ok: false, error: '缺少 API Key（本机未填，服务器也未配置）' }, { status: 422 });

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
      return Response.json({ ok: false, error: errMsg ? `接口报错：${errMsg.slice(0, 120)}` : '接口返回空回复' }, { status: 200 });
    }
    return Response.json({ ok: true, data: { reply: reply.slice(0, 50) } });
  } catch (e) {
    const err = e as { name?: string };
    console.error('ai test: fetch failed:', err?.name ?? 'unknown');
    const reason = err?.name === 'AbortError' ? '连接超时（20s）' : '网络错误，无法连接该地址';
    return Response.json({ ok: false, error: reason }, { status: 200 });
  }
}
