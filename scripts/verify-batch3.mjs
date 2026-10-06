#!/usr/bin/env node
// 批次 3 验收脚本（只在隔离的本地实例/隔离库上跑）
// 覆盖：3-3 入店码一次性化 / 3-4 评价 7 天窗口 / 3-1 上传正常路径
// 3-1 的"台账写失败 → 回滚 R2 对象"要临时藏起 uploads 表制造 D1 故障，而运行中的 workerd
// 与 CLI 争抢同一份 SQLite（见 README 的本地验证坑），所以那一步不能在本脚本里做，手动走：
//   1. 停实例 → ALTER TABLE uploads RENAME TO uploads_off;
//   2. 起实例 → POST /api/upload 得 500，wrangler 日志打印 "object rolled back: <key>"
//   3. GET /api/images/<key> 得 404（对象已回滚，对照组：正常上传的 key 仍 200）
//   4. 停实例 → ALTER TABLE uploads_off RENAME TO uploads;
//
// 用法：
//   node scripts/verify-batch3.mjs [--base http://127.0.0.1:8899] [--persist-to ./.wrangler-verify]
//
// 造出来的行 rider_token 一律以 `b3` 开头（16 位十六进制），脚本结束时自删，不留残留。
// 上传子项只删台账行、不删 R2 对象——对象落在 --persist-to 指定的隔离目录里，随目录一起丢弃。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const argAt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (argAt('--base') || 'http://127.0.0.1:8899').replace(/\/+$/, '');
const PERSIST = argAt('--persist-to') || './.wrangler-verify';
const DB = argAt('--db') || 'warm-journey-db';
const WRANGLER = path.resolve(import.meta.dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

if (/\.wrangler$/.test(PERSIST) || PERSIST === '.wrangler') {
  console.error('✗ --persist-to 指向了默认的 .wrangler 库，会污染本机日常数据。');
  console.error('  请用隔离目录，例如 --persist-to ./.wrangler-verify');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name, extra = '') => { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); };
const bad = (name, extra = '') => { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); };

function d1(sql) {
  const r = spawnSync(process.execPath, [
    WRANGLER, 'd1', 'execute', DB, '--local', '--persist-to', PERSIST,
    '--command', sql, '-y', '--json',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`d1 失败：${(r.stderr || r.stdout || '').split('\n').slice(0, 3).join(' ')}`);
  const body = (r.stdout || '').trim().replace(/^/, '');
  return JSON.parse(body.slice(body.indexOf('[')));
}
const rows = (sql) => d1(sql)[0]?.results ?? [];

async function post(p, payload) {
  const res = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json, text: JSON.stringify(json ?? {}) };
}

// 1px PNG（合法魔数 + 合法 CRC，能被 upload 路由的魔数校验接受）
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

function newToken() {
  return 'b3' + crypto.randomBytes(7).toString('hex');
}

const created = [];

function cleanup() {
  try {
    d1(`DELETE FROM visit_feedback WHERE visit_id IN (SELECT id FROM visits WHERE rider_token LIKE 'b3%');`);
    d1(`DELETE FROM visits WHERE rider_token LIKE 'b3%';`);
    console.log(`\n· 已清理本次造出的 ${created.length} 条 visit（rider_token LIKE 'b3%'）`);
  } catch (e) {
    console.error('· 清理失败，请手动执行：DELETE FROM visits WHERE rider_token LIKE \'b3%\';', e.message);
  }
}

(async () => {
  console.log(`目标实例：${BASE}　库：${DB}（--local --persist-to ${PERSIST}）`);

  const points = rows('SELECT id FROM service_points ORDER BY id LIMIT 3');
  if (points.length < 1) throw new Error('隔离库里没有 service_points，先 db:migrate + db:seed');
  const pointId = points[0].id;
  console.log(`测试点位：${pointId}\n`);

  console.log('[3-3] 入店码一次性化');
  const tokA = newToken();
  const r1 = await post(`/api/points/${pointId}/reserve`, { rider_token: tokA });
  if (!r1.json?.data?.visit?.id) throw new Error(`预约失败：${r1.status} ${r1.text}`);
  const visitA = r1.json.data.visit;
  created.push(visitA.id);
  const codeA = rows(`SELECT checkin_code FROM visits WHERE id = '${visitA.id}'`)[0].checkin_code;
  if (!codeA) throw new Error('预约后库里没有 checkin_code，后续断言无意义');

  const wrong = await post(`/api/visits/${visitA.id}/checkin`, { code: 'zzzzzzzzzz' });
  wrong.status === 403 ? ok('reserved + 错误码 → 403') : bad('reserved + 错误码', `${wrong.status} ${wrong.json?.error}`);

  const good = await post(`/api/visits/${visitA.id}/checkin`, { code: codeA });
  good.status === 200 && good.json?.ok ? ok('reserved + 正确码 → 200 入店') : bad('正确码入店', `${good.status} ${good.text}`);

  const after = rows(`SELECT status, checkin_code FROM visits WHERE id = '${visitA.id}'`)[0];
  after.checkin_code === null ? ok('入店后库内 checkin_code = NULL', `status=${after.status}`)
    : bad('入店后 checkin_code 未清除', `仍在：${after.checkin_code}`);

  const dup = await post(`/api/visits/${visitA.id}/checkin`, { code: codeA });
  dup.status === 200 && dup.json?.data?.already === true
    ? ok('重复扫同一张已消费码 → already（幂等，不是 bad_code）')
    : bad('重复扫已消费码', `${dup.status} ${dup.text}`);

  const cancelReserved = await post(`/api/visits/${visitA.id}/cancel`, { rider_token: tokA });
  cancelReserved.status === 409 ? ok('in_store 不能被 cancel → 409（状态机未松动）')
    : bad('in_store cancel', `${cancelReserved.status} ${cancelReserved.text}`);

  const act = await post('/api/visits/active', { point_id: pointId, rider_token: tokA });
  !act.json?.data?.visit?.checkin_code ? ok('active(in_store) 不再下发 checkin_code')
    : bad('active 仍下发码', act.json.data.visit.checkin_code);
  (!act.text.includes('created_ip') && !act.text.includes(tokA))
    ? ok('active 响应仍无 created_ip / 完整 rider_token') : bad('active 脱敏', act.text.slice(0, 160));

  console.log('\n[3-4] 离店评价 7 天窗口');
  const out = await post(`/api/visits/${visitA.id}/checkout`, { rider_token: tokA });
  out.status === 200 ? ok('离店成功') : bad('离店', `${out.status} ${out.text}`);

  const fb1 = await post(`/api/visits/${visitA.id}/feedback`, { rider_token: tokA, rating: 5, supports: ['充电'], suggestion: 'batch3 窗口内' });
  fb1.status === 201 ? ok('离店当场评价 → 201') : bad('窗口内评价', `${fb1.status} ${fb1.text}`);

  const tokB = newToken();
  const r2 = await post(`/api/points/${pointId}/reserve`, { rider_token: tokB });
  const visitB = r2.json?.data?.visit;
  if (!visitB?.id) throw new Error(`第二笔预约失败：${r2.status} ${r2.text}`);
  created.push(visitB.id);
  const codeB = rows(`SELECT checkin_code FROM visits WHERE id = '${visitB.id}'`)[0].checkin_code;
  await post(`/api/visits/${visitB.id}/checkin`, { code: codeB });
  await post(`/api/visits/${visitB.id}/checkout`, { rider_token: tokB });

  d1(`UPDATE visits SET checked_out_at = unixepoch() - 8 * 86400 WHERE id = '${visitB.id}'`);
  const fb2 = await post(`/api/visits/${visitB.id}/feedback`, { rider_token: tokB, rating: 4, supports: [], suggestion: 'batch3 窗口外' });
  fb2.status === 409 && /7 天/.test(fb2.json?.error ?? '')
    ? ok('离店 8 天后评价 → 409 评价已过期', fb2.json.error)
    : bad('窗口外评价', `${fb2.status} ${fb2.text}`);

  d1(`UPDATE visits SET checked_out_at = unixepoch() - (7 * 86400 - 3600) WHERE id = '${visitB.id}'`);
  const fb3 = await post(`/api/visits/${visitB.id}/feedback`, { rider_token: tokB, rating: 4, supports: [], suggestion: 'batch3 边界' });
  fb3.status === 201 ? ok('窗口边界（6 天 23 小时）仍可评价 → 201') : bad('窗口边界', `${fb3.status} ${fb3.text}`);

  console.log('\n[3-1] 上传正常路径（回滚子项见脚本头注释，需停实例制造故障）');
  const fd = new FormData();
  fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'batch3-ok.png');
  const up1 = await fetch(`${BASE}/api/upload`, { method: 'POST', body: fd });
  const up1Json = await up1.json().catch(() => null);
  const key1 = up1Json?.data?.key;
  up1.status === 201 && key1 ? ok('上传 → 201', key1) : bad('上传正常路径', `${up1.status} ${JSON.stringify(up1Json)}`);
  if (key1) {
    const img = await fetch(`${BASE}/api/images/${key1}`);
    img.status === 200 ? ok('对象可读回 200') : bad('对象读回', img.status);
    const led = rows(`SELECT key FROM uploads WHERE key = '${key1}'`);
    led.length === 1 ? ok('台账已记账') : bad('台账记账', `${led.length} 行`);
    d1(`DELETE FROM uploads WHERE key = '${key1}'`);
  }

  console.log(`\n小计：✓ ${pass} ✗ ${fail}`);
  cleanup();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('\n脚本异常：', e.message); cleanup(); process.exit(1); });
