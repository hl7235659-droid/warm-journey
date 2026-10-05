import { getRequestContext } from '@cloudflare/next-on-pages';
import { z } from 'zod';
import {
  getPoint, getOccupancy, getPointFeedbackSummary, searchKnowledge, getVisit, checkRateLimit,
} from '@/lib/db';
import { matchSiteHelp } from '@/lib/ai/site-help';
import { buildMessages, type PointPromptInfo } from '@/lib/ai/prompt';
import { normalizeMessages, MAX_MESSAGE_CHARS } from '@/lib/ai/truncate';
import { extractAction, IdSchema } from '@/lib/ai/actions';
import { localFallback } from '@/lib/ai/fallback';
import { validateBaseUrl, fetchWithTimeout, chatCompletionsUrl } from '@/lib/ai/fetch';
import { requireAdmin } from '@/lib/auth';
import { getClientIp, jsonErr } from '@/lib/http';
import { STATUS_LABELS } from '@/lib/types';
import type { AiContext, AiAction, ChatResponse } from '@/lib/ai/types';

export const runtime = 'edge';

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

function localResponse(text: string, action?: ChatResponse['action']): Response {
  const body: ChatResponse = { ok: true, mode: 'local', text, action };
  return Response.json(body, { headers: { 'X-Ai-Mode': 'local' } });
}

// POST /api/ai/chat
export async function POST(req: Request) {
  const { env } = getRequestContext();
  const e = env as unknown as {
    JWT_SECRET?: string;
    AI_BASE_URL?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
    AI_ALLOWED_HOSTS?: string;
  };

  // 管理端受众（AI 周报等）必须先过管理员鉴权
  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonErr('请求格式错误', 400);
  }
  const audienceProbe = (body as { audience?: unknown } | null)?.audience;
  if (audienceProbe === 'admin') {
    const auth = await requireAdmin(req, e);
    if (auth instanceof Response) return auth;
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return jsonErr('参数验证失败', 422);
  const input = parsed.data;

  const ip = getClientIp(req);
  // 限流：每 IP 每分钟 20 次（双窗口滑动）
  const allowed = await checkRateLimit(env.DB, `chat:${ip}`, { limit: 20, windowSec: 60 });
  if (!allowed) {
    return jsonErr('小暖有点忙，请一分钟后再试～', 429);
  }
  // 每 IP 每日 200 次：压住单点滥用
  const dailyAllowed = await checkRateLimit(env.DB, `chat:daily:${ip}`, { limit: 200, windowSec: 86400 });
  if (!dailyAllowed) {
    return jsonErr('今日的对话额度已用完，请明天再来～', 429);
  }
  // 全站每日总量：分布式 IP / IPv6 轮换无法线性放大服务端 Key 消耗
  const day = Math.floor(Date.now() / 86400_000);
  const globalAllowed = await checkRateLimit(env.DB, `chat:global:${day}`, { limit: GLOBAL_DAILY_LIMIT, windowSec: 86400 });
  if (!globalAllowed) {
    return jsonErr('今天的小暖太忙了，请明天再来～', 429);
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
    : matchSiteHelp(lastUser.content, 'rider', 3);
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
    try {
      const point = await getPoint(env.DB, input.pointId);
      if (point) {
        const [occ, feedback] = await Promise.all([
          getOccupancy(env.DB, point.id),
          getPointFeedbackSummary(env.DB, point.id),
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
        pointInfo = {
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
      }
    } catch (e) {
      console.error('ai chat: point info failed:', (e as { message?: string })?.message ?? 'unknown');
    }
  }

  const context = (input.context ?? undefined) as AiContext | undefined;
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
  // BYOK 仅走 https（validateBaseUrl 强制），且受每 IP 与全站每日上限约束；
  // 服务端 AI_* 环境变量只作为兜底，同样受每日上限约束。
  let baseUrl = '';
  let apiKey = '';
  let model = '';
  let temperature = 0.3;
  if (input.provider) {
    const v = validateBaseUrl(input.provider.baseUrl, e.AI_ALLOWED_HOSTS);
    if (!v.ok) return jsonErr(`提供商地址无效：${v.error}`, 422);
    baseUrl = v.url;
    apiKey = input.provider.apiKey;
    model = input.provider.model;
    temperature = input.provider.temperature ?? 0.3;
  } else if (e.AI_BASE_URL && e.AI_API_KEY && e.AI_MODEL) {
    const v = validateBaseUrl(e.AI_BASE_URL, e.AI_ALLOWED_HOSTS);
    if (v.ok) {
      baseUrl = v.url;
      apiKey = e.AI_API_KEY;
      model = e.AI_MODEL;
    }
  }

  if (!baseUrl || !apiKey || !model) {
    // 无任何可用提供商 → 本地降级
    const fb = localFallback(lastUser.content, context, pointInfo, {
      audience,
      dataText: input.dataText,
    });
    return localResponse(fb.text, fb.action);
  }

  // ---------- 远端转发 ----------
  try {
    const res = await fetchWithTimeout(chatCompletionsUrl(baseUrl), REQUEST_TIMEOUT_MS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        stream: false,
        messages,
        // DeepSeek V4 系默认开启思考（reasoning），无 off 档，low 为最小开销；
        // 仅对 deepseek.com 下发该参数，避免其他 OpenAI 兼容服务因未知字段报错
        ...(baseUrl.includes('deepseek.com') ? { reasoning_effort: 'low' } : {}),
      }),
    });
    if (!res.ok) {
      console.error('ai chat: provider http error, status:', res.status);
      // 上游错误不透传原文，只给通用文案（详情留服务端日志）
      return remoteFailedFallback(lastUser.content, context, pointInfo, '模型接口暂时不可用', { audience, dataText: input.dataText });
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    const rawText = payload.choices?.[0]?.message?.content ?? '';
    if (!rawText) {
      const errMsg = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      console.error('ai chat: provider empty reply:', errMsg?.slice(0, 200) ?? 'no error detail');
      return remoteFailedFallback(lastUser.content, context, pointInfo, '模型接口返回异常', { audience, dataText: input.dataText });
    }

    // 解析并校验 action
    const { text, action } = extractAction(rawText);
    const safeAction = await validateAction(env.DB, action);

    const body: ChatResponse = { ok: true, mode: 'remote', text, action: safeAction, model };
    return Response.json(body);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    console.error('ai chat: fetch failed:', err?.name ?? 'unknown', err?.message ?? '');
    return remoteFailedFallback(lastUser.content, context, pointInfo, '网络异常，暂时无法联网回答', { audience, dataText: input.dataText });
  }
}

// 远端失败 → 本地降级回答，并在文本中如实告知已切换本地模式
function remoteFailedFallback(
  userMessage: string,
  context: AiContext | undefined,
  point: import('@/lib/ai/fallback').FallbackPointInfo | undefined,
  reason: string,
  options?: import('@/lib/ai/fallback').FallbackOptions,
): Response {
  const fb = localFallback(userMessage, context, point, options);
  const text = `（联网模型调用失败：${reason}，已切换本地回答）\n\n${fb.text}`;
  return localResponse(text, fb.action);
}

// action 的 pointId/visitId 必须真实存在，否则丢弃整个 action（只保留文本）
async function validateAction(db: D1Database, action?: AiAction): Promise<AiAction | undefined> {
  if (!action) return undefined;
  try {
    if (action.params.pointId) {
      const point = await getPoint(db, action.params.pointId);
      if (!point) return undefined;
    }
    if (action.params.visitId) {
      const visit = await getVisit(db, action.params.visitId);
      if (!visit) return undefined;
    }
  } catch (e) {
    console.error('ai chat: action validation failed:', (e as { message?: string })?.message ?? 'unknown');
    return undefined;
  }
  return action;
}
