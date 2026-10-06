import { getCloudflareContext } from '@opennextjs/cloudflare';
import { z } from 'zod';
import {
  getPoint, getOccupancy, getPointFeedbackSummary, searchKnowledge, checkRateLimit,
} from '@/lib/db';
import { matchSiteHelp } from '@/lib/ai/site-help';
import { buildMessages, type PointPromptInfo } from '@/lib/ai/prompt';
import { normalizeMessages, MAX_MESSAGE_CHARS, type WireMessage } from '@/lib/ai/truncate';
import { extractAction, IdSchema } from '@/lib/ai/actions';
import { localFallback } from '@/lib/ai/fallback';
import { validateBaseUrl, chatCompletionsUrl, resolveServerProvider, type ServerAiEnv } from '@/lib/ai/fetch';
import { requireAdmin } from '@/lib/auth';
import { getClientIp, jsonErr } from '@/lib/http';
import { STATUS_LABELS } from '@/lib/types';
import type { AiContext, AiAction, ChatResponse } from '@/lib/ai/types';

const REQUEST_TIMEOUT_MS = 90_000;

// 全站每日对话总量上限（服务端 Key 兜底消耗的总闸门，按 UTC 日计）
const GLOBAL_DAILY_LIMIT = 3000;

const BodySchema = z.object({
  audience: z.enum(['rider', 'admin']).optional(),
  dataText: z.string().max(8000).optional(),
  provider: z.object({
    baseUrl: z.string().max(300),
    apiKey: z.string().max(300),
    model: z.string().min(1).max(120),
    temperature: z.number().min(0).max(2).optional(),
  }).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(MAX_MESSAGE_CHARS),
  })).min(1).max(30),
  pointId: IdSchema.optional(),
  context: z.object({
    now: z.string().max(60).optional(),
    weather: z.object({
      city: z.string().max(40),
      text: z.string().max(40),
      temp: z.number(),
      warning: z.string().max(80).optional(),
    }).nullable().optional(),
    nearby: z.array(z.object({
      id: z.string().max(32),
      name: z.string().max(80),
      dist: z.string().max(20),
      inStore: z.number().int().min(0),
      openHours: z.string().max(60),
      services: z.array(z.string().max(20)).max(20),
      crowdHint: z.string().max(20),
    })).max(5).optional(),
  }).optional(),
});

type ChatBody = z.infer<typeof BodySchema>;

function localResponse(text: string, action?: ChatResponse['action']): Response {
  // 降级事实已经在 body.mode 里（响应头的 X-Ai-Mode 写一次零读取，删）
  return Response.json({ ok: true, mode: 'local', text, action } satisfies ChatResponse);
}

// POST /api/ai/chat
export async function POST(req: Request) {
  const { env } = getCloudflareContext();

  // 管理端受众（AI 周报等）必须先过管理员鉴权
  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonErr('请求格式错误', 400);
  }
  const audienceProbe = (body as { audience?: unknown } | null)?.audience;
  if (audienceProbe === 'admin') {
    const auth = await requireAdmin(req, env);
    if (auth instanceof Response) return auth;
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonErr('参数验证失败', 422);
  const input = parsed.data;

  const ip = getClientIp(req);
  // 限流两条，都在转发前拦：每 IP 每分钟 20 次（README 承诺口径，双窗口滑动）+ 每 IP 每日 200 次。
  // 全站日额不在这里：它只拦"烧服务端 Key"的请求，见下面提供商解析之后的 usesServerKey 分支。
  const allowed = await checkRateLimit(env.DB, `chat:${ip}`, { limit: 20, windowSec: 60 });
  if (!allowed) {
    return jsonErr('小暖有点忙，请一分钟后再试～', 429);
  }
  const dailyAllowed = await checkRateLimit(env.DB, `chat:daily:${ip}`, { limit: 200, windowSec: 86400 });
  if (!dailyAllowed) {
    return jsonErr('今日的对话额度已用完，请明天再来～', 429);
  }

  const history = normalizeMessages(input.messages);
  // 契约：messages 末条就是本次提问，之前的一律算历史。提问由 buildMessages 末尾
  // 单独追加一次，这里必须把它从历史里切掉——客户端与服务端各认一半正是 B1 双发的成因。
  const lastUser = history[history.length - 1];
  if (!lastUser || lastUser.role !== 'user') return jsonErr('缺少用户消息', 422);
  const prior = history.slice(0, -1);

  // ---------- prompt 组装 ----------
  const audience = input.audience ?? 'rider';
  const siteHelp = audience === 'admin'
    ? []
    : matchSiteHelp(lastUser.content, 3);
  let knowledge: Awaited<ReturnType<typeof searchKnowledge>> = [];
  if (audience === 'rider') {
    try {
      knowledge = await searchKnowledge(env.DB, lastUser.content, { topN: 3 });
    } catch (e) {
      console.error('ai chat: knowledge search failed:', (e as { message?: string })?.message ?? 'unknown');
    }
  }

  let pointInfo: PointPromptInfo | undefined;
  if (input.pointId) {
    pointInfo = await assemblePointInfo(env.DB, input.pointId);
  }

  const context = (input.context ?? undefined) as AiContext | undefined;

  // 降级入参只组装一次（此前 4 个失败分支逐字抄了 4 遍 audience/dataText）
  const fallbackArgs = { audience, dataText: input.dataText };
  // 远端失败 → 本地降级回答，并在文本中如实告知已切换本地模式
  const remoteFailedFallback = (reason: string): Response => {
    const fb = localFallback(lastUser.content, context, pointInfo, fallbackArgs);
    return localResponse(`（联网模型调用失败：${reason}，已切换本地回答）\n\n${fb.text}`, fb.action);
  };

  const messages = buildMessages({
    userMessage: lastUser.content,
    history: prior,
    siteHelp,
    knowledge: knowledge.map((k) => ({ title: k.title, content: k.content, category: k.category })),
    point: pointInfo,
    context,
    audience,
    dataText: input.dataText,
  });

  // ---------- 提供商解析：请求自带（BYOK）→ 环境变量 → 本地降级 ----------
  // BYOK 仅走 https（validateBaseUrl 强制），受每 IP 的分钟/日额约束——它烧的是用户自己的
  // Key，不占全站额度；服务端 AI_* 环境变量兜底另外受全站日额约束（usesServerKey 分支）。
  const resolved = resolveProvider(input.provider, env);
  if (!resolved.ok) return jsonErr(resolved.message, 422);
  const provider = resolved.provider;
  if (!provider) {
    // 无任何可用提供商 → 本地降级
    const fb = localFallback(lastUser.content, context, pointInfo, fallbackArgs);
    return localResponse(fb.text, fb.action);
  }

  // 全站每日总量：分布式 IP / IPv6 轮换无法线性放大服务端 Key 消耗。
  // 只有真正会用服务端 Key 转发的请求才计数，BYOK 请求既不该被它拦、也不该消耗它。
  if (provider.usesServerKey) {
    const day = Math.floor(Date.now() / 86400_000);
    const globalAllowed = await checkRateLimit(env.DB, `chat:global:${day}`, { limit: GLOBAL_DAILY_LIMIT, windowSec: 86400 });
    if (!globalAllowed) {
      return jsonErr('今天的小暖太忙了，请明天再来～', 429);
    }
  }

  // ---------- 远端转发 ----------
  const forwarded = await forwardToProvider(env.DB, provider, messages);
  if (!forwarded.ok) return remoteFailedFallback(forwarded.reason);

  // model 不进响应体：服务端兜底用的是哪家模型属实现细节，BYOK 的用户本来就知道自己填了什么
  const resBody: ChatResponse = { ok: true, mode: 'remote', text: forwarded.text, action: forwarded.action };
  return Response.json(resBody);
}

// ---------------------------------------------------------------------------
// POST 的三段主体（L17 拆分）：站点上下文组装 / 提供商解析 / 远端转发。
// POST 本身只保留鉴权、限流与调度。
// ---------------------------------------------------------------------------

// 站点上下文：详情 + 实时在店/预约人数 + 近 30 天口碑摘要。
// 查询失败静默降级为"无站点信息"，不阻断对话主链路（与拆分前行为一致）。
async function assemblePointInfo(db: D1Database, pointId: string): Promise<PointPromptInfo | undefined> {
  try {
    const point = await getPoint(db, pointId);
    if (!point) return undefined;
    const [occ, feedback] = await Promise.all([
      getOccupancy(db, point.id),
      getPointFeedbackSummary(db, point.id),
    ]);
    let feedbackSummary: string | undefined;
    if (feedback) {
      const parts = [
        `近30天 ${feedback.count} 条离店反馈，均分 ${feedback.avgRating}，${feedback.goodRate}% 给了4分以上`,
        feedback.topSupports.length > 0
          ? `骑手最希望的支持：${feedback.topSupports.map((s) => `${s.tag}×${s.n}`).join('、')}`
          : '',
        feedback.recentSuggestions.length > 0
          ? `近期建议原文：${feedback.recentSuggestions.map((s) => `"${s}"`).join('；')}`
          : '',
      ].filter(Boolean);
      feedbackSummary = parts.join('；');
    }
    return {
      name: point.name,
      address: point.address,
      openHours: point.open_hours,
      status: STATUS_LABELS[point.status],
      services: point.services,
      capacity: point.admission?.capacity,
      notes: point.notes || undefined,
      inStore: occ.in_store,
      reserved: occ.reserved,
      feedbackSummary,
    };
  } catch (e) {
    console.error('ai chat: point info failed:', (e as { message?: string })?.message ?? 'unknown');
    return undefined;
  }
}

// 解析出的转发目标。usesServerKey 决定该请求是否受全站日额约束：
// BYOK 烧用户自己的 Key，不受；服务端 AI_* 兜底烧站内 Key，受。
interface ResolvedProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  usesServerKey: boolean;
}

type ProviderResolution =
  | { ok: true; provider: ResolvedProvider | null }
  | { ok: false; message: string };

// 提供商解析：请求自带（BYOK）→ 环境变量 → null（无可用提供商，调用方走本地降级）。
// 纯计算不碰库。BYOK 地址非法时返回 ok:false（调用方 422，文案与拆分前一致）；
// BYOK 三要素不齐（apiKey 在 zod 里无 min，可为空串）返回 null，与拆分前的
// `!baseUrl || !apiKey || !model` 完整性检查同口径，不带着空 Bearer 出网。
function resolveProvider(byok: ChatBody['provider'], env: ServerAiEnv): ProviderResolution {
  if (byok) {
    const v = validateBaseUrl(byok.baseUrl, env.AI_ALLOWED_HOSTS);
    if (!v.ok) return { ok: false, message: `提供商地址无效：${v.error}` };
    if (!v.url || !byok.apiKey || !byok.model) return { ok: true, provider: null };
    return {
      ok: true,
      provider: {
        baseUrl: v.url,
        apiKey: byok.apiKey,
        model: byok.model,
        temperature: byok.temperature ?? 0.3,
        usesServerKey: false,
      },
    };
  }
  const server = resolveServerProvider(env);
  if (!server) return { ok: true, provider: null };
  return {
    ok: true,
    provider: { ...server, temperature: 0.3, usesServerKey: true },
  };
}

// 远端转发：一次 chat/completions 往返 + action 解析与点位存在性校验。
// 失败一律返回 ok:false，reason 已按"可直接对用户说"的口径拟好，由调用方包装成本地降级。
async function forwardToProvider(
  db: D1Database,
  provider: ResolvedProvider,
  messages: WireMessage[],
): Promise<{ ok: true; text: string; action?: AiAction } | { ok: false; reason: string }> {
  try {
    const res = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: provider.temperature,
        stream: false,
        messages,
        // DeepSeek V4 系默认开启思考（reasoning），无 off 档，low 为最小开销；
        // 仅对 deepseek.com 下发该参数，避免其他 OpenAI 兼容服务因未知字段报错
        ...(provider.baseUrl.includes('deepseek.com') ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('ai chat: provider http error, status:', res.status);
      // 上游错误不透传原文，只给通用文案（详情留服务端日志）
      return { ok: false, reason: '模型接口暂时不可用' };
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    const rawText = payload.choices?.[0]?.message?.content ?? '';
    if (!rawText) {
      const errMsg = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      console.error('ai chat: provider empty reply:', errMsg?.slice(0, 200) ?? 'no error detail');
      return { ok: false, reason: '模型接口返回异常' };
    }

    // 解析并校验 action
    const { text, action } = extractAction(rawText);
    const safeAction = await validateAction(db, action);
    return { ok: true, text, action: safeAction };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    console.error('ai chat: fetch failed:', err?.name ?? 'unknown', err?.message ?? '');
    return { ok: false, reason: '网络异常，暂时无法联网回答' };
  }
}

// action 的 pointId 必须真实存在，否则丢弃整个 action（只保留文本）
async function validateAction(db: D1Database, action?: AiAction): Promise<AiAction | undefined> {
  if (!action) return undefined;
  try {
    if (action.params.pointId) {
      const point = await getPoint(db, action.params.pointId);
      if (!point) return undefined;
    }
  } catch (e) {
    console.error('ai chat: action validation failed:', (e as { message?: string })?.message ?? 'unknown');
    return undefined;
  }
  return action;
}
