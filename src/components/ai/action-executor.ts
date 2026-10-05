'use client';
// 命令执行器：zod 白名单校验 → 分流执行。
// 读操作（navigate/filter/route）直接执行；写操作（reserve/report）
// 只做「带路 + 预填」（跳转到既有表单页），绝不自动提交。
import { ActionSchema } from '@/lib/ai/actions';
import { navToPoint } from '@/lib/nav';
import { api } from '@/lib/api-client';
import type { AiAction } from '@/lib/ai/types';

export interface ExecResult {
  ok: boolean;
  message: string;
}

export async function executeAction(
  action: AiAction,
  push: (href: string) => void,
): Promise<ExecResult> {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success) {
    return { ok: false, message: '操作指令无效或已过期' };
  }
  const a = parsed.data;

  switch (a.type) {
    // navigate 与 reserve 落地行为一致（都是去详情页），预约仍要用户在卡片里确认。
    // 两个 action 名分开只为提示词层区分意图，文案各归各。
    case 'navigate':
    case 'reserve': {
      push(`/point/${a.params.pointId}`);
      return {
        ok: true,
        message: a.type === 'reserve' ? '已打开站点详情，请在预约卡片里确认预约' : '正在打开站点详情',
      };
    }
    case 'filter': {
      const qs = new URLSearchParams();
      if (a.params.city) qs.set('city', a.params.city);
      if (a.params.service) qs.set('service', a.params.service);
      push(`/?${qs.toString()}`);
      return { ok: true, message: '正在按条件筛选' };
    }
    case 'report': {
      // category 已由 ActionSchema 的 z.enum(REPORT_CATEGORIES) 限定，可直接拼接
      const qs = a.params.category ? `?category=${a.params.category}` : '';
      if (a.params.pointId) {
        push(`/point/${a.params.pointId}/report${qs}`);
        return { ok: true, message: '已打开上报页，请核对信息后提交' };
      }
      push('/');
      return { ok: true, message: '请先选择要上报的站点' };
    }
    case 'route': {
      const json = await api<{ lat: number; lng: number; name: string }>(`/api/points/${a.params.pointId}`);
      if (!json.ok) return { ok: false, message: json.error ?? '获取站点信息失败' };
      if (!json.data) return { ok: false, message: '站点不存在或已下线' };
      navToPoint(json.data.lat, json.data.lng, json.data.name);
      return { ok: true, message: '已唤起地图导航' };
    }
    case 'list_knowledge':
      // 不可达：AiDock 的 handleExecuteAction 在调用执行器之前就拦了本类型（拉条目并
      // 作为消息展示）。留着这一支是为了让 switch 对判别式联合穷尽——将来新增 action
      // 类型时编译器仍会提醒补分支，代价比写个 default 兜底小。
      return { ok: true, message: '' };
  }
}

// list_knowledge 专用：拉取知识条目并格式化为展示文本
export async function fetchKnowledgeFor(action: AiAction): Promise<string | null> {
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success || parsed.data.type !== 'list_knowledge') return null;
  const json = await api<{ title: string; content: string; category: string }[]>(
    `/api/ai/knowledge?category=${parsed.data.params.category}`,
  );
  if (!json.ok) return '知识库暂时取不到，请稍后再试。';
  if (!json.data || json.data.length === 0) {
    return '这类知识暂时没有条目。可以换个类别问，或直接描述你的问题。';
  }
  return json.data
    .map((k) => `📖 ${k.title}\n${k.content}`)
    .join('\n\n————————\n\n');
}
