// 消息截断（跨境云创模式的防御性写法，限额收紧适配 Edge）：
// 角色白名单、单条 ≤MAX_MESSAGE_CHARS 字、总量 ≤2 万字符、只留最近 30 条。

// 单条消息硬上限：/api/ai/chat 的 zod 入参校验与这里的截断共用同一来源
// （此前 8000/4000 两处矛盾）。常量放本文件而不是 ai/types：scripts/tests 用
// node --experimental-strip-types 直跑，扩展名必须写全，types 的反向 import 会断掉单测。
export const MAX_MESSAGE_CHARS = 4000;

export interface WireMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const MAX_TOTAL = 20000;
const MAX_COUNT = 30;

/**
 * 按 Unicode 码点裁剪：string.slice 会在代理对中间切断，emoji 被切成半个就成了乱码方块。
 * from='head' 保留前 max 个码点，'tail' 保留后 max 个（总量预算内截断最旧的一条用 tail）。
 */
export function clip(s: string, max: number, from: 'head' | 'tail' = 'head'): string {
  if (s.length <= max) return s; // UTF-16 长度不超限 ⇒ 码点数必不超限，免去建数组
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return (from === 'head' ? chars.slice(0, max) : chars.slice(-max)).join('');
}

export function normalizeMessages(
  messages: Array<{ role?: unknown; content?: unknown }>,
): WireMessage[] {
  const cleaned: WireMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string' || !m.content.trim()) continue;
    cleaned.push({ role: m.role, content: clip(m.content, MAX_MESSAGE_CHARS) });
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
        out.unshift({ role: recent[i].role, content: clip(recent[i].content, remain, 'tail') });
      }
      break;
    }
    total += len;
    out.unshift(recent[i]);
  }
  return out;
}
