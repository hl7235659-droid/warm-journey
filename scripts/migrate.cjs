// D1 结构对齐（可重复执行）：补 schema.sql 表达不了的缺列，再整体重跑 schema.sql。
// 用法：npm run db:migrate:safe            （本地）
//       npm run db:migrate:safe:prod       （远程）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DB_NAME, SCHEMA_FILE, REQUIRED_COLUMNS, REQUIRED_TABLES, BACKFILL_AFTER_ADD,
} = require('./db-objects.cjs');

const REMOTE = process.argv.includes('--remote');

function run(args, { silent = true } = {}) {
  const r = spawnSync('npx', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0 && !silent) console.log(out);
  return { ok: r.status === 0, out };
}

// SQLite 没有 ADD COLUMN IF NOT EXISTS：先探测列在不在（SELECT 该列 LIMIT 0 只在缺列时报错）
function exists(probeSql) {
  const tmp = path.join(os.tmpdir(), `wj-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmp, probeSql, 'utf8');
  const r = run(['wrangler', 'd1', 'execute', DB_NAME, '--file', tmp, '-y', REMOTE ? '--remote' : '--local']);
  fs.rmSync(tmp, { force: true });
  return r.ok;
}

function runSql(sql) {
  const tmp = path.join(os.tmpdir(), `wj-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const r = run(['wrangler', 'd1', 'execute', DB_NAME, '--file', tmp, '-y', REMOTE ? '--remote' : '--local'], { silent: false });
  fs.rmSync(tmp, { force: true });
  return r;
}

console.log(`→ ${REMOTE ? '远程' : '本地'} D1 结构对齐：${DB_NAME}`);

let added = 0;
for (const [label, probe, ddl] of REQUIRED_COLUMNS) {
  if (exists(probe)) { console.log(`  = ${label} 已存在`); continue; }
  const r = runSql(ddl);
  if (!r.ok) { console.error(`✗ ${label} 补列失败：\n${r.out}`); process.exit(1); }
  console.log(`  + ${label} 已补列`);
  added++;
}

if (added > 0) {
  for (const [label, sql] of BACKFILL_AFTER_ADD) {
    const r = runSql(sql);
    if (!r.ok) { console.error(`✗ ${label} 失败：\n${r.out}`); process.exit(1); }
    console.log(`  ~ ${label} 完成`);
  }
}

// 建表与建索引全是 IF NOT EXISTS，无需逐个探测，整体重跑即可
const schema = run(['wrangler', 'd1', 'execute', DB_NAME, '--file', SCHEMA_FILE, '-y', REMOTE ? '--remote' : '--local'], { silent: false });
if (!schema.ok) { console.error('✗ schema.sql 执行失败（存量脏数据可能违反唯一约束，需先人工清理）：\n' + schema.out); process.exit(1); }
console.log('  ✓ schema.sql 已重跑（表与索引对齐）');

for (const [label, probe] of [...REQUIRED_COLUMNS.map(c => [c[0], c[1]]), ...REQUIRED_TABLES]) {
  if (!exists(probe)) { console.error(`✗ 迁移后校验失败：${label}`); process.exit(1); }
}
console.log(`✓ 结构对齐完成（本次补列 ${added} 项），硬依赖对象校验通过`);
