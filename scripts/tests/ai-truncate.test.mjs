// 消息截断回归测试：这一层是所有 AI 请求的入口闸门，写错会以「乱码」或「422」的形式
// 出现在用户面前，且历史上 8000/4000 两处限额矛盾就是从这里冒出来的。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clip, normalizeMessages, MAX_MESSAGE_CHARS } from '../../src/lib/ai/truncate.ts';

test('clip 不在代理对中间下刀（emoji 不会被切成乱码方块）', () => {
  // 3999 个 A + 两个 emoji：码点数 4001 超限，裁剪点正好落在 🐶 的前半之前。
  // 旧的 s.slice(0, 4000) 会切出半个代理对（\ud83d 落单 → 渲染成方块）。
  const s = 'A'.repeat(MAX_MESSAGE_CHARS - 1) + '🐱🐶';
  const out = clip(s, MAX_MESSAGE_CHARS);
  assert.equal(out, 'A'.repeat(MAX_MESSAGE_CHARS - 1) + '🐱');
  // 未超限必须原样返回（快速路径）
  assert.equal(clip('短文本', 100), '短文本');
  // tail 模式同样按码点对齐
  assert.equal(clip('🐱🐶🦊', 2, 'tail'), '🐶🦊');
});

test('normalizeMessages 用同一来源的单条上限，并挡掉非法角色与空内容', () => {
  const long = 'x'.repeat(MAX_MESSAGE_CHARS + 500);
  const out = normalizeMessages([
    { role: 'user', content: long },
    { role: 'system', content: '越权角色' },
    { role: 'assistant', content: '   ' },
    { role: 'user', content: '你好' },
  ]);
  assert.deepEqual(out.map((m) => m.role), ['user', 'user']);
  assert.equal(out[0].content.length, MAX_MESSAGE_CHARS);
});

test('normalizeMessages 总量预算内只截最旧一条，保留最新消息', () => {
  const a = { role: 'user', content: 'y'.repeat(MAX_MESSAGE_CHARS) };
  const out = normalizeMessages([a, a, a, a, a, a, a, { role: 'user', content: '尾' }]);
  // 预算 20000：最新 4 条整条保留 + 第 5 新的一条只留下尾部 3999 字，更旧的整条丢弃
  assert.equal(out.length, 6);
  assert.equal(out[out.length - 1].content, '尾');
  assert.equal(out[0].content.length, 20000 - 4 * MAX_MESSAGE_CHARS - 1);
  assert.ok(out.reduce((n, m) => n + m.content.length, 0) <= 20000);
});
