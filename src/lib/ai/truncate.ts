// 消息截断（跨境云创模式的防御性写法，限额收紧适配 Edge）：
// 角色白名单、单条 ≤4000 字、总量 ≤2 万字符、只留最近 30 条。

export interface WireMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const MAX_PER_MSG = 4000;
const MAX_TOTAL = 20000;
const MAX_COUNT = 30;

export function normalizeMessages(
  messages: Array<{ role?: unknown; content?: unknown }>,
): WireMessage[] {
  const cleaned: WireMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string' || !m.content.trim()) continue;
    cleaned.push({ role: m.role, content: m.content.slice(0, MAX_PER_MSG) });
  }
  const recent = cleaned.slice(-MAX_COUNT);
  // 总量截断：从最新往回保留，超预算时丢最旧的一条（剩余空间太小也直接丢弃）
  let total = 0;
  const out: WireMessage[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const len = recent[i].content.length;
    const remain = MAX_TOTAL - total;
    if (len > remain) {
      if (remain >= 200) {
        out.unshift({ role: recent[i].role, content: recent[i].content.slice(-remain) });
      }
      break;
    }
    total += len;
    out.unshift(recent[i]);
  }
  return out;
}
