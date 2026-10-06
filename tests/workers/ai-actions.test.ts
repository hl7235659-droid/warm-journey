// 7-3 · extractAction 裸 JSON 兜底收紧（L5）的护栏：
// 旧实现用 /\{[\s\S]*"action"[\s\S]*\}\s*$/ 从首个 { 贪婪吞到串尾，正文里一旦有其他花括号
// （如示例文字、markdown 片段），候选必解析失败 → action 静默丢失。
// 收紧后为就近平衡配对：从串尾最后一个 } 回溯找配对的 {，仅解析该片段。
// 围栏分支的端到端行为在 ai-degradation.test.ts 里另有覆盖，此处聚焦兜底分支本身。
import { describe, expect, it } from 'vitest';

import { extractAction } from '@/lib/ai/actions';

describe('extractAction 兜底分支（L5 收紧后）', () => {
  it('正文含其他花括号 + 文末裸 action：就近配对命中，action 不再丢失，示例花括号留在正文', () => {
    const raw = '格式如 {"type":"navigate"} 所示。\n{"action":{"type":"filter","params":{"city":"广州"}}}';
    const { text, action } = extractAction(raw);
    expect(action).toEqual({ type: 'filter', params: { city: '广州' } });
    expect(text).toContain('{"type":"navigate"}');
    expect(text).not.toContain('"action"');
  });

  it('裸 action 后仍有收尾文字：action 照常提取，收尾文字保留', () => {
    const raw = '好的 {"x":1}\n{"action":{"type":"navigate","params":{"pointId":"point0000nav1"}}} 希望有帮助';
    const { text, action } = extractAction(raw);
    expect(action).toEqual({ type: 'navigate', params: { pointId: 'point0000nav1' } });
    expect(text).toContain('好的 {"x":1}');
    expect(text).toContain('希望有帮助');
    expect(text).not.toContain('"action"');
  });

  it('串尾 JSON 不含 action：不误剥正文（无 action、原文保留）', () => {
    const raw = '这是说明 {"a":1} 结束';
    const { text, action } = extractAction(raw);
    expect(action).toBeUndefined();
    expect(text).toBe(raw);
  });

  it('只有右半边花括号（无法配对）：跳过兜底，正文原样', () => {
    const raw = '花括号没闭合 { "oops": 1';
    const { text, action } = extractAction(raw);
    expect(action).toBeUndefined();
    expect(text).toBe(raw);
  });

  it('文末裸 wrapper JSON（旧主路径）：行为不变', () => {
    const raw = '这就带你去\n{"action":{"type":"route","params":{"pointId":"point0000rt01"}}}';
    const { text, action } = extractAction(raw);
    expect(action).toEqual({ type: 'route', params: { pointId: 'point0000rt01' } });
    expect(text).toBe('这就带你去');
  });
});
