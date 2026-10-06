// 纯逻辑回归测试：node --test scripts/tests
// 覆盖本轮修复中"最容易再次写错"的三块：出站地址白名单、分页钳制、点位 schema 同源性。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateBaseUrl, isTrustedProviderHost, chatCompletionsUrl } from '../../src/lib/ai/fetch.ts';
import { pageParams, clampInt, MAX_PAGE_SIZE } from '../../src/lib/pagination.ts';
import { PointCreateSchema, PointUpdateSchema, POINT_ADMISSION_SCHEMA } from '../../src/lib/point-schema.ts';

// ---------- AI 出站地址校验（防开放代理 / SSRF） ----------

test('baseUrl 必须是 https', () => {
  assert.equal(validateBaseUrl('http://api.deepseek.com/v1').ok, false);
  assert.match(validateBaseUrl('http://api.deepseek.com/v1').error ?? '', /HTTPS/);
  assert.equal(validateBaseUrl('').ok, false);
  assert.equal(validateBaseUrl('not a url').ok, false);
});

test('内网与本机地址一律拒绝', () => {
  for (const bad of ['https://localhost/v1', 'https://127.0.0.1/v1', 'https://10.0.0.5/v1',
                     'https://192.168.1.1/v1', 'https://svc.internal/v1', 'https://[::1]/v1']) {
    assert.equal(validateBaseUrl(bad).ok, false, bad);
  }
});

test('非白名单域名被拒（开放代理面关闭）', () => {
  const r = validateBaseUrl('https://evil.example.com/v1');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /受信任/);
});

test('主流提供商放行，自定义域名需经 AI_ALLOWED_HOSTS 追加', () => {
  assert.equal(validateBaseUrl('https://api.deepseek.com/v1').ok, true);
  assert.equal(validateBaseUrl('https://api.openai.com/v1').ok, true);
  assert.equal(validateBaseUrl('https://relay.example.com/v1').ok, false);
  assert.equal(validateBaseUrl('https://relay.example.com/v1', 'relay.example.com').ok, true);
});

test('子域只认受信任父域，尾斜杠被规范化', () => {
  assert.equal(isTrustedProviderHost('api.us.openrouter.ai'), true);
  assert.equal(isTrustedProviderHost('notopenrouter.ai'), false);
  assert.equal(validateBaseUrl('https://api.deepseek.com/v1/').url, 'https://api.deepseek.com/v1');
  assert.equal(chatCompletionsUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
  // AI_ALLOWED_HOSTS 追加项的 trim / 大小写 / 空项容错，从公开入口验（原实现里
  // allowedProviderHosts 是内部函数，不再导出）
  assert.equal(validateBaseUrl('https://relay.example.com/v1', ' ,, Relay.EXAMPLE.com ,').ok, true);
  assert.equal(validateBaseUrl('https://evil.example.com/v1', ',,').ok, false);
});

// ---------- 分页钳制（防 500 与全表拉取） ----------

test('pageParams 把非法与越界值收敛到合法区间', () => {
  assert.deepEqual(pageParams(new URLSearchParams('page=abc&page_size=abc')), { page: 1, page_size: 20 });
  assert.deepEqual(pageParams(new URLSearchParams('page_size=999999')).page_size, MAX_PAGE_SIZE);
  assert.deepEqual(pageParams(new URLSearchParams('page_size=0')).page_size, 1);
  assert.deepEqual(pageParams(new URLSearchParams('page=-5')).page, 1);
  // 默认页大小仍可调，上限不可调（历史上第三参只有本测试在用）
  assert.deepEqual(pageParams(new URLSearchParams('page=2.7&page_size=10'), 20), { page: 2, page_size: 10 });
  assert.equal(clampInt('-1', 5, 1, 10), 1);
  assert.equal(clampInt(null, 7, 1, 10), 7);
});

// ---------- 点位 schema：POST/PUT 必须同源 ----------

test('POST 有默认值，PUT 缺省字段不得被套成默认值', () => {
  const created = PointCreateSchema.parse({ name: '站点', address: '地址', lat: 23.1, lng: 113.3 });
  assert.equal(created.status, 'open');
  assert.deepEqual(created.admission, {});

  const updated = PointUpdateSchema.parse({ notes: '只改备注' });
  assert.equal(updated.notes, '只改备注');
  // 这三行是"PUT 会不会误清列"的关键：undefined 才会被 updatePoint 跳过
  assert.equal('status' in updated, false);
  assert.equal('admission' in updated, false);
  assert.equal('services' in updated, false);
});

test('PUT 仍继承 POST 的全部取值约束', () => {
  assert.equal(PointUpdateSchema.safeParse({ lat: 200 }).success, false);
  assert.equal(PointUpdateSchema.safeParse({ lng: -181 }).success, false);
  assert.equal(PointUpdateSchema.safeParse({ status: 'paused' }).success, false);
  assert.equal(PointUpdateSchema.safeParse({ name: '' }).success, false);
});

test('admission 结构化：capacity 有上限，notes 限长', () => {
  assert.equal(POINT_ADMISSION_SCHEMA.safeParse({ capacity: 99999 }).success, false);
  assert.equal(POINT_ADMISSION_SCHEMA.safeParse({ capacity: 20, id_required: true }).success, true);
  assert.equal(POINT_ADMISSION_SCHEMA.safeParse({ capacity: 20, unknown_key: 'x' }).success, true);
});
