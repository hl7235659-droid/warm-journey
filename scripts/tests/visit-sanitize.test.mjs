// visit 公开响应脱敏回归测试：node --test scripts/tests
// M1/M5：rider_token（操作他人预约的钥匙）、created_ip / checkin_code（反滥用内部字段）
// 曾被 SELECT v.* 原样下发。以下用例锁定"公开响应不含内部字段"这一口径。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeVisit } from '../../src/lib/visit-sanitize.ts';

const ROW = {
  id: 'a1b2c3d4e5f60718',
  point_id: 'point001',
  point_name: '天河驿站',
  rider_token: '0123456789abcdef0123456789abcdef',
  status: 'reserved',
  reserved_at: 1760000000,
  checked_in_at: null,
  checked_out_at: null,
  created_at: 1760000000,
  created_ip: '203.0.113.9',
  checkin_code: 'k9m2x7q4td',
};

const INTERNAL = ['rider_token', 'created_ip', 'checkin_code'];

test('默认剥离三个内部字段，序列化后不含其值', () => {
  const out = sanitizeVisit(ROW);
  const json = JSON.stringify(out);
  for (const key of INTERNAL) assert.equal(key in out, false, key);
  for (const value of [ROW.rider_token, ROW.checkin_code, ROW.created_ip]) {
    assert.equal(json.includes(value), false, `响应里出现了 ${value}`);
  }
});

test('业务字段原样保留（脱敏不得顺带吃掉前端要用的列）', () => {
  const out = sanitizeVisit(ROW);
  assert.equal(out.id, ROW.id);
  assert.equal(out.point_id, ROW.point_id);
  assert.equal(out.point_name, '天河驿站');
  assert.equal(out.status, 'reserved');
  assert.equal(out.reserved_at, ROW.reserved_at);
  assert.equal(out.checked_out_at, null);
});

test('keepCode：本人进行中预约保留入店码，token 与 IP 仍剥离', () => {
  // VisitCard 的入店二维码 = `${origin}/checkin/${visit.id}?c=${checkin_code}`
  const out = sanitizeVisit(ROW, { keepCode: true });
  assert.equal(out.checkin_code, ROW.checkin_code);
  assert.equal('rider_token' in out, false);
  assert.equal('created_ip' in out, false);
});

test('keepCode 遇到已消费的入店码（NULL）不再下发空字段', () => {
  const out = sanitizeVisit({ ...ROW, checkin_code: null }, { keepCode: true });
  assert.equal('checkin_code' in out, false);
});

test('maskToken：只给前 6 位，完整 token 不出现在响应中', () => {
  // 入店确认页要显示"骑手标识"，与管理端列表同口径
  const out = sanitizeVisit(ROW, { maskToken: true });
  assert.equal(out.rider_token, '012345…');
  assert.equal(JSON.stringify(out).includes(ROW.rider_token), false);
  assert.equal('checkin_code' in out, false);
  assert.equal('created_ip' in out, false);
});

test('脱敏不改动传入的 DB 行', () => {
  const row = { ...ROW };
  sanitizeVisit(row, { keepCode: true, maskToken: true });
  assert.deepEqual(Object.keys(row), Object.keys(ROW));
  assert.equal(row.rider_token, ROW.rider_token);
  assert.equal(row.checkin_code, ROW.checkin_code);
});
