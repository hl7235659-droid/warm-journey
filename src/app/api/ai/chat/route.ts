import { getRequestContext } from '@cloudflare/next-on-pages';
import { z } from 'zod';
import {
  getPoint, getOccupancy, getPointFeedbackSummary, searchKnowledge, getVisit, checkRateLimit,
} from '@/lib/db';
import { matchSiteHelp } from '@/lib/ai/site-help';
import { buildMessages, type PointPromptInfo } from '@/lib/ai/prompt';
import { normalizeMessages } from '@/lib/ai/truncate';
import { extractAction } from '@/lib/ai/actions';
import { localFallback } from '@/lib/ai/fallback';
import { validateBaseUrl, fetchWithTimeout, chatCompletionsUrl } from '@/lib/ai/fetch';
import { STATUS_LABELS } from '@/lib/types';
import type { AiContext, AiAction, ChatResponse } from '@/lib/ai/types';

export const runtime = 'edge';

const REQUEST_TIMEOUT_MS = 90_000;

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
    content: z.string().max(8000),
  })).min(1).max(30),
  pointId: z.string().regex(/^[a-z0-9]{4,32}$/).optional(),
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

function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'local';
}

function localResponse(text: string, action?: ChatResponse['action']): Response {
  const body: ChatResponse = { ok: true, mode: 'local', text, action };
  return Response.json(body, { headers: { 'X-Ai-Mode': 'local' } });
}

// POST /api/ai/chat
export async function POST(req: Request) {
  const { env } = getRequestContext();

  let body: unknown;
  try { body = await req.json(); } catch {
    return Response.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: '参数验证失败' }, { status: 422 });
  const input = parsed.data;

  // 限流：每 IP 每分钟 20 次
  const allowed = await checkRateLimit(env.DB, clientIp(req), { limit: 20, windowSec: 60 });
  if (!allowed) {
    return Response.json(
      { ok: false, error: '小暖有点忙，请一分钟后再试～' },
      { status: 429 },
    );
  }

  const history = normalizeMessages(input.messages);
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) return Response.json({ ok: false, error: '缺少用户消息' }, { status: 422 });

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
    history,
    siteHelp,
    knowledge: knowledge.map((k) => ({ title: k.title, content: k.content, category: k.category })),
    point: pointInfo,
    context,
    audience,
    dataText: input.dataText,
  });

  // ---------- 提供商解析：请求体 → 环境变量 → 本地降级 ----------
  let baseUrl = '';
  let apiKey = '';
  let model = '';
  let temperature = 0.3;
  if (input.provider) {
    const v = validateBaseUrl(input.provider.baseUrl);
    if (!v.ok) return Response.json({ ok: false, error: `提供商地址无效：${v.error}` }, { status: 422 });
    baseUrl = v.url;
    apiKey = input.provider.apiKey;
    model = input.provider.model;
    temperature = input.provider.temperature ?? 0.3;
  } else if (env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL) {
    const v = validateBaseUrl(env.AI_BASE_URL);
    if (v.ok) {
      baseUrl = v.url;
      apiKey = env.AI_API_KEY;
      model = env.AI_MODEL;
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
      return remoteFailedFallback(lastUser.content, context, pointInfo, `模型接口返回错误（HTTP ${res.status}）`, { audience, dataText: input.dataText });
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    const rawText = payload.choices?.[0]?.message?.content ?? '';
    if (!rawText) {
      const errMsg = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      console.error('ai chat: provider empty reply');
      return remoteFailedFallback(
        lastUser.content, context, pointInfo,
        errMsg ? `模型接口错误：${errMsg.slice(0, 120)}` : '模型接口返回空回复',
        { audience, dataText: input.dataText },
      );
    }

    // 解析并校验 action
    const { text, action } = extractAction(rawText);
    const safeAction = await validateAction(env.DB, action);

    const body: ChatResponse = { ok: true, mode: 'remote', text, action: safeAction, model };
    return Response.json(body);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const reason = err?.name === 'AbortError' ? '请求超时（90s）' : '网络错误';
    console.error('ai chat: fetch failed:', err?.name ?? 'unknown');
    return remoteFailedFallback(lastUser.content, context, pointInfo, reason, { audience, dataText: input.dataText });
  }
}

// 远端失败 → 本地降级回答，并在文本中如实告知原因
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
