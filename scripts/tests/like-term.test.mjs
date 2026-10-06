// LIKE 检索词归一回归测试：node --test scripts/tests
// L2：搜索词此前直接拼进 `%${q}%`——参数化能防注入，但 q="%" 会把包含匹配放大成
// 全表命中，q="_" 任意单字符匹配，超长串还会让 LIKE 扫完整段文本。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { likeTerm } from '../../src/lib/like-term.ts';

test('通配符与引号、反斜杠被剥离', () => {
  assert.equal(likeTerm('100%真实_地址'), '100真实地址');
  assert.equal(likeTerm('a\\b"c'), 'abc');
  assert.equal(likeTerm('%'), '');
  assert.equal(likeTerm('_'), '');
  assert.equal(likeTerm('%_%'), '');
});

test('返回空串表示"该条件应当整体跳过"，而不是 %% 全表匹配', () => {
  // listPoints 依赖这一点：if (qq) 才 push WHERE，否则等价于不加筛选
  for (const raw of ['%', '%%', '_', '%_\\"', '   ', '   %  ']) {
    assert.equal(likeTerm(raw), '', JSON.stringify(raw));
  }
});

test('首尾空白收敛，普通检索词原样通过', () => {
  assert.equal(likeTerm('  天河  '), '天河');
  assert.equal(likeTerm('天河驿站'), '天河驿站');
  assert.equal(likeTerm('Tianhe-Station 2'), 'Tianhe-Station 2');
});

test('长度默认截到 50，可传上限', () => {
  assert.equal(likeTerm('站'.repeat(200)).length, 50);
  assert.equal(likeTerm('abcdefghij', 4).length, 4);
  // 剥离通配符在前、截断在后：长度上限管的是真正进 LIKE 的字符数
  assert.equal(likeTerm('%%%abcdef', 3), 'abc');
});
