// 服务端 prompt 组装（顺序：角色 → 站点功能知识 → 业务知识 → 当前站点 → 动态上下文 → 协议）
import type { WireMessage } from './truncate';
import { normalizeMessages } from './truncate';
import type { HelpEntry } from './site-help';
import { ACTION_PROTOCOL_PROMPT } from './actions';
import { PERSONA_PROMPT, ADMIN_PERSONA_PROMPT } from './persona';
import type { AiContext } from './types';

export interface KnowledgeRef {
  title: string;
  content: string;
  category: string;
}

export interface PointPromptInfo {
  name: string;
  address: string;
  openHours: string;
  status: string;            // 中文状态
  services: string[];
  capacity?: number;
  notes?: string;
  inStore: number;
  reserved: number;
  feedbackSummary?: string;  // T2 口碑摘要（近30天评分/支持标签/建议）
}

export interface PromptInput {
  userMessage: string;
  history: Array<{ role?: unknown; content?: unknown }>;
  siteHelp: HelpEntry[];
  knowledge: KnowledgeRef[];
  point?: PointPromptInfo;
  context?: AiContext;
  audience?: 'rider' | 'admin';
  dataText?: string;              // 管理端统计注入（T3 周报）
}

const ROLE_PROMPT = PERSONA_PROMPT;
const ADMIN_ROLE_PROMPT = ADMIN_PERSONA_PROMPT;

function section(title: string, body: string): string {
  return `\n【${title}】\n${body}`;
}

export function buildMessages(input: PromptInput): WireMessage[] {
  const isAdmin = input.audience === 'admin';
  const parts: string[] = [isAdmin ? ADMIN_ROLE_PROMPT : ROLE_PROMPT];

  if (input.dataText) {
    parts.push(section('统计数据（周报以此为准，禁止编造）', input.dataText));
  }

  if (!isAdmin && input.siteHelp.length > 0) {
    const body = input.siteHelp
      .map((e) => `《${e.title}》\n${e.content}`)
      .join('\n\n');
    parts.push(section('站点功能说明（回答"怎么用"时以此为准）', body));
  }

  if (input.knowledge.length > 0) {
    const body = input.knowledge
      .map((k) => `《${k.title}》（类别：${k.category}）\n${k.content}`)
      .join('\n\n');
    parts.push(section('官方知识条目（引用时注明出处标题）', body));
  }

  if (input.point) {
    const p = input.point;
    let body =
      `名称：${p.name}\n地址：${p.address}\n状态：${p.status}\n营业时间：${p.openHours}\n` +
      `服务项目：${p.services.join('、') || '无'}\n` +
      `当前在店 ${p.inStore} 人${p.capacity ? ` / 容纳 ${p.capacity} 人` : ''}，预约未到 ${p.reserved} 人`;
    if (p.notes) body += `\n备注：${p.notes}`;
    if (p.feedbackSummary) body += `\n近30天口碑：${p.feedbackSummary}`;
    parts.push(section('当前站点资料（用户正在该站点详情页提问）', body));
  }

  if (input.context) {
    const c = input.context;
    let body = `当前时间：${c.now}`;
    if (c.weather) body += `\n天气：${c.weather.city} ${c.weather.text} ${c.weather.temp}°C${c.weather.warning ? `（${c.weather.warning}）` : ''}`;
    if (c.nearby.length > 0) {
      body +=
        '\n附近开放驿站（按距离）：\n' +
        c.nearby
          .map(
            (n) =>
              `- ${n.name}（${n.dist}，id: ${n.id}）：营业 ${n.openHours}，在店 ${n.inStore} 人，服务：${n.services.join('、') || '无'}，客流：${n.crowdHint}`,
          )
          .join('\n');
    }
    parts.push(section('实时上下文（优先据此回答"现在/附近/挤不挤"类问题）', body));
  }

  if (!isAdmin) parts.push(ACTION_PROTOCOL_PROMPT);

  const history = normalizeMessages(input.history);
  // 末条若与最新消息重复则去重
  const trimmed = [...history];
  if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === 'user') {
    trimmed.pop();
  }
  return [
    { role: 'system', content: parts.join('\n') },
    ...trimmed,
    { role: 'user', content: input.userMessage.slice(0, 4000) },
  ];
}
