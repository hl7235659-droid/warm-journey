'use client';
// 命令执行器：zod 白名单校验 → 分流执行。
// 读操作（navigate/filter/route/list_knowledge）直接执行；写操作（reserve/report/feedback）
// 只做「带路 + 预填」（跳转到既有表单页），绝不自动提交。
import { ActionSchema } from '@/lib/ai/actions';
import { navToPoint } from '@/lib/nav';
import type { AiAction, AiContext, ChatSession } from '@/lib/ai/types';

export interface ExecResult {
  ok: boolean;
  message: string;
}

const REPORT_CATEGORY_QUERY: Record<string, string> = {
  closed: 'closed',
  info_wrong: 'info_wrong',
  facility: 'facility',
  safety: 'safety',
  other: 'other',
};

interface NavRouter {
  push: (href: string) => void;
}

export async function executeAction(
  action: AiAction,
  router: NavRouter,
): Promise<ExecResult> {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success) {
    return { ok: false, message: '操作指令无效或已过期' };
  }
  const a = parsed.data;

  switch (a.type) {
    case 'navigate': {
      router.push(`/point/${a.params.pointId}`);
      return { ok: true, message: '正在打开站点详情' };
    }
    case 'filter': {
      const qs = new URLSearchParams();
      if (a.params.city) qs.set('city', a.params.city);
      if (a.params.service) qs.set('service', a.params.service);
      router.push(`/?${qs.toString()}`);
      return { ok: true, message: '正在按条件筛选' };
    }
    case 'reserve': {
      // 写操作：带路到详情页的预约卡片，由用户自行确认
      router.push(`/point/${a.params.pointId}`);
      return { ok: true, message: '已打开站点详情，请在预约卡片里确认预约' };
    }
    case 'report': {
      const category = a.params.category ? REPORT_CATEGORY_QUERY[a.params.category] : null;
      if (a.params.pointId) {
        router.push(`/point/${a.params.pointId}/report${category ? `?category=${category}` : ''}`);
        return { ok: true, message: '已打上上报页，请核对信息后提交' };
      }
      router.push('/');
      return { ok: true, message: '请先选择要上报的站点' };
    }
    case 'route': {
      try {
        const res = await fetch(`/api/points/${a.params.pointId}`);
        const json = (await res.json()) as { ok: boolean; data?: { lat: number; lng: number; name: string } };
        if (!json.ok || !json.data) return { ok: false, message: '站点不存在或已下线' };
        navToPoint(json.data.lat, json.data.lng, json.data.name);
        return { ok: true, message: '已唤起地图导航' };
      } catch {
        return { ok: false, message: '获取站点信息失败' };
      }
    }
    case 'feedback': {
      try {
        const res = await fetch(`/api/visits/${a.params.visitId}`);
        const json = (await res.json()) as { ok: boolean; data?: { point_id: string } };
        if (!json.ok || !json.data) return { ok: false, message: '到访记录不存在' };
        router.push(`/checkout/${json.data.point_id}`);
        return { ok: true, message: '已打开离店反馈页' };
      } catch {
        return { ok: false, message: '获取到访记录失败' };
      }
    }
    case 'list_knowledge': {
      // 由调用方（AiDock）处理：拉取条目并作为消息展示
      return { ok: true, message: '__knowledge__' };
    }
  }
}

// list_knowledge 专用：拉取知识条目并格式化为展示文本
export async function fetchKnowledgeFor(action: AiAction): Promise<string | null> {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success || parsed.data.type !== 'list_knowledge') return null;
  try {
    const res = await fetch(`/api/ai/knowledge?category=${parsed.data.params.category}`);
    const json = (await res.json()) as {
      ok: boolean;
      data?: Array<{ title: string; content: string; category: string }>;
    };
    if (!json.ok || !json.data || json.data.length === 0) {
      return '这类知识暂时没有条目。可以换个类别问，或直接描述你的问题。';
    }
    return json.data
      .map((k) => `📖 ${k.title}\n${k.content}`)
      .join('\n\n————————\n\n');
  } catch {
    return '知识库暂时取不到，请稍后再试。';
  }
}

// 发送请求体组装（AiDock / ChatPanel 共用）
export async function buildChatRequestBody(
  session: ChatSession,
  withUserMessage: string,
  provider: { baseUrl: string; apiKey: string; model: string; temperature: number } | null,
) {
  const { getContext } = await import('./ai-context');
  const context: AiContext | null = await getContext();
  const history = session.messages
    .slice(-11) // 之前 11 条 + 本条 = 12 条
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    provider: provider && provider.apiKey ? provider : undefined,
    messages: [...history, { role: 'user' as const, content: withUserMessage }],
    pointId: session.pointId,
    context: context ?? undefined,
  };
}
