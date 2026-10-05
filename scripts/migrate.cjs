// 可重放的 D1 迁移执行器：先读现状，只补缺失的列/表/索引，重复执行不再报 duplicate column。
// 用法：npm run db:migrate:safe            （本地）
//       npm run db:migrate:safe:prod       （远程）
//       node scripts/migrate.cjs --file=src/lib/db/migrate-20261005.sql --remote
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REMOTE = process.argv.includes('--remote');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const SQL_FILE = path.resolve(__dirname, '..', fileArg ? fileArg.slice('--file='.length) : 'src/lib/db/migrate-20261005.sql');
const DB_NAME = 'warm-journey-db';

function runSql(sql, { silent = true } = {}) {
  const tmp = path.join(os.tmpdir(), `wj-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const args = ['wrangler', 'd1', 'execute', DB_NAME, '--file', tmp, '-y', REMOTE ? '--remote' : '--local'];
  const r = spawnSync('npx', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  fs.rmSync(tmp, { force: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0 && !silent) console.log(out);
  return { ok: r.status === 0, out };
}

// D1 查询返回 JSON 文本，这里只用来判断"存在与否"，不解析结构
function queryValue(sql) {
  const { ok, out } = runSql(sql);
  return ok ? out : '';
}

function main() {
  if (!fs.existsSync(SQL_FILE)) {
    console.error(`✗ 找不到迁移文件：${SQL_FILE}`);
    process.exit(1);
  }
  console.log(`→ ${REMOTE ? '远程' : '本地'} D1 迁移：${path.relative(process.cwd(), SQL_FILE)}`);

  const checks = [
    // [描述, 探测"已存在"的查询, 需要补执行的语句]
    ['reports.query_code',
      "SELECT query_code FROM reports LIMIT 0;",
      "ALTER TABLE reports ADD COLUMN query_code TEXT;"],
    ['point_confirms.rider_token',
      "SELECT rider_token FROM point_confirms LIMIT 0;",
      "ALTER TABLE point_confirms ADD COLUMN rider_token TEXT;"],
    ['visits.created_ip',
      "SELECT created_ip FROM visits LIMIT 0;",
      "ALTER TABLE visits ADD COLUMN created_ip TEXT;"],
    ['visits.checkin_code',
      "SELECT checkin_code FROM visits LIMIT 0;",
      "ALTER TABLE visits ADD COLUMN checkin_code TEXT;"],
  ];

  let applied = 0;
  for (const [what, probe, ddl] of checks) {
    if (queryValue(probe)) {
      console.log(`  = ${what} 已存在`);
      continue;
    }
    const { ok, out } = runSql(ddl);
    if (!ok) { console.error(`✗ ${what} 创建失败：\n${out}`); process.exit(1); }
    console.log(`  + ${what} 已补列`);
    applied++;
  }

  // 存量数据回填：只在确实缺值时执行，幂等
  const backfill = [
    ["回填查询码", "UPDATE reports SET query_code = substr(id, 1, 10) WHERE query_code IS NULL;"],
    ["回填入店码", "UPDATE visits SET checkin_code = lower(hex(randomblob(5))) WHERE checkin_code IS NULL AND status IN ('reserved','in_store');"],
  ];
  for (const [label, sql] of backfill) {
    const { ok, out } = runSql(sql);
    if (!ok) { console.error(`✗ ${label} 失败：\n${out}`); process.exit(1); }
    console.log(`  ~ ${label} 完成`);
  }

  // 表与索引全部用 IF NOT EXISTS，天然可重放，直接跑文件里的剩余语句
  const rest = fs.readFileSync(SQL_FILE, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^(CREATE|DROP)\b/i.test(s));
  if (rest.length > 0) {
    const { ok, out } = runSql(`${rest.join(';\n')};`);
    if (!ok) { console.error(`✗ 索引/表创建失败（存量脏数据可能违反唯一约束，需先人工清理）：\n${out}`); process.exit(1); }
    console.log(`  + ${rest.length} 条 CREATE 语句已执行`);
  }

  // 迁移后端自检：关键对象齐备才算成功
  const verify = [
    "SELECT checkin_code, created_ip FROM visits LIMIT 0;",
    "SELECT query_code FROM reports LIMIT 0;",
    "SELECT key, ip FROM uploads LIMIT 0;",
  ];
  for (const v of verify) {
    if (!queryValue(v)) { console.error(`✗ 迁移后校验失败：${v}`); process.exit(1); }
  }
  console.log(`✓ 迁移完成（本次补列 ${applied} 项），关键对象校验通过`);
}

main();
