// 命令操作系统：协议文本（教模型输出）+ zod 白名单校验 + 文本提取
import { z } from 'zod';
import { ID_RE, REPORT_CATEGORIES, KNOWLEDGE_CATEGORIES } from '@/lib/types';
import type { AiAction } from './types';

// 数据库主键形态见 ID_RE（@/lib/types）
export const IdSchema = z.string().regex(ID_RE, 'id 格式无效');
const name128 = z.string().min(1).max(64);

// 逐类型 params 形状（判别式联合：类型白名单 + 参数形状双重校验）
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    params: z.object({ pointId: IdSchema }),
  }),
  z.object({
    type: z.literal('filter'),
    params: z
      .object({ city: name128.optional(), service: name128.optional() })
      .refine((v) => v.city || v.service, { message: 'filter 至少需要 city 或 service 之一' }),
  }),
  z.object({
    type: z.literal('reserve'),
    params: z.object({ pointId: IdSchema }),
  }),
  z.object({
    type: z.literal('report'),
    params: z.object({ pointId: IdSchema.optional(), category: z.enum(REPORT_CATEGORIES).optional() }),
  }),
  z.object({
    type: z.literal('route'),
    params: z.object({ pointId: IdSchema }),
  }),
  z.object({
    type: z.literal('list_knowledge'),
    params: z.object({ category: z.enum(KNOWLEDGE_CATEGORIES) }),
  }),
]);

export type ParsedAction = z.infer<typeof ActionSchema>;

// 写进 system prompt 的协议全文
export const ACTION_PROTOCOL_PROMPT = `【操作指令协议】
当你判断用户想执行以下操作时，在回复正文结束后，另起一行附加一个 json 代码块（仅一个，放在回复最末尾）：
\`\`\`json
{"action": {"type": "<类型>", "params": {...}}}
\`\`\`
可用类型与参数：
- navigate        {"pointId": "站点id"}          跳转到某驿站详情页
- filter          {"city": "城市名"} 或 {"service": "服务名"}   回到首页并按条件筛选（至少给一项）
- reserve         {"pointId": "站点id"}          带用户去发起预约（需用户确认）
- report          {"pointId": "站点id(可选)", "category": "closed|info_wrong|facility|safety|other(可选)"}  打开问题上报页
- route           {"pointId": "站点id"}          打开地图导航去某驿站
- list_knowledge  {"category": "rights|channel|faq|notice"}   展示某类官方知识条目
规则：
1. pointId 只能使用资料中明确提供的 id，禁止编造；
2. 只在用户意图明确时才附加操作指令；普通问答不要附加；
3. 代码块之外不要出现裸 JSON；一个回复最多一个操作指令。`;

export function actionToWire(parsed: ParsedAction): AiAction {
  return { type: parsed.type, params: parsed.params as { [k: string]: string } };
}

function tryParseActionCandidate(raw: string): AiAction | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const wrapper = obj as { action?: unknown };
  const candidate = wrapper.action && typeof wrapper.action === 'object' ? wrapper.action : obj;
  const result = ActionSchema.safeParse(candidate);
  if (result.success) return actionToWire(result.data);
  return null;
}

// 从模型回复中提取 action（容忍 ```json 围栏 / 裸 JSON 两种形态），剥离后返回纯文本
export function extractAction(text: string): { text: string; action?: AiAction } {
  if (!text) return { text };
  // 1) 围栏代码块（带或不带 json 语言标记）
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let action: AiAction | undefined;
  let cleaned = text;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1].trim();
    if (!body.includes('"action"') && !body.includes("'action'")) continue;
    const parsed = tryParseActionCandidate(body);
    if (parsed) {
      action = parsed;
      cleaned = cleaned.replace(m[0], '');
      break;
    }
  }
  // 2) 兜底：文末裸 JSON 对象（模型偶发漏围栏）
  if (!action) {
    const tailRe = /\{[\s\S]*"action"[\s\S]*\}\s*$/;
    const tail = text.match(tailRe);
    if (tail) {
      const start = tail.index ?? -1;
      const candidate = text.slice(start).trim();
      const parsed = tryParseActionCandidate(candidate);
      if (parsed) {
        action = parsed;
        cleaned = cleaned.slice(0, start);
      }
    }
  }
  return { text: cleaned.replace(/\n{3,}$/, '\n\n').trim(), action };
}
