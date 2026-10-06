// Workers 部署入口：部署前做硬性预检，避免"先发代码后跑迁移/漏配密钥"导致线上 500。
// 用法：npm run deploy
//       SKIP_PREFLIGHT=1 npm run deploy   （仅在你确认预检不适用于本次时用）
// 批次 9 迁 OpenNext 后从 Pages direct-upload 切到 Workers：
//   - wrangler.toml 的 account_id 对 Workers 是合法字段，不再需要仓库外 cwd 绕法
//   - secret 是 Worker 级（wrangler secret list / put），没有 --project-name/--branch
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DB_NAME, ACCOUNT_ID, REQUIRED_COLUMNS, REQUIRED_TABLES } = require('./db-objects.cjs');

const db = DB_NAME;
// 直接点名仓库里的 wrangler，避免 npx 在异常 cwd 下从注册表现场拉新 wrangler
const WRANGLER_BIN = path.resolve(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const BUILD_BIN = path.resolve(__dirname, '..', 'node_modules', '.bin', 'opennextjs-cloudflare');

function runWrangler(args) {
  const [, ...rest] = args;
  return spawnSync(process.execPath, [WRANGLER_BIN, ...rest], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
  });
}

function remoteSql(sql) {
  const tmp = path.join(os.tmpdir(), `wj-preflight-${Date.now()}.sql`);
  fs.writeFileSync(tmp, sql, 'utf8');
  const r = runWrangler(['wrangler', 'd1', 'execute', db, '--file', tmp, '-y', '--remote']);
  fs.rmSync(tmp, { force: true });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function preflight() {
  console.log('→ 预检 1/2：远程 D1 是否已具备代码硬依赖的列与表');
  // 清单与 scripts/migrate.cjs 同源（db-objects.cjs），不再各抄一份
  const probes = [...REQUIRED_COLUMNS.map(c => [c[0], c[1]]), ...REQUIRED_TABLES];
  const missing = [];
  for (const [label, sql] of probes) {
    const { ok } = remoteSql(sql);
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) missing.push(label);
  }
  if (missing.length > 0) {
    console.error(`✗ 远程库缺 ${missing.length} 项：${missing.join('、')}`);
    console.error('  先执行：npm run db:migrate:safe:prod  （可重放，只补缺失项）');
    process.exit(1);
  }

  console.log('→ 预检 2/2：JWT_SECRET 是否已作为 Worker secret 注入');
  const secrets = runWrangler(['wrangler', 'secret', 'list']);
  const text = `${secrets.stdout ?? ''}${secrets.stderr ?? ''}`;
  if (secrets.status !== 0) {
    console.error('✗ 无法读取 Worker secret 列表（wrangler 未登录或 Worker 不存在）：');
    console.error(text.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
  if (!/\bJWT_SECRET\b/.test(text)) {
    console.error('✗ 缺少 JWT_SECRET。缺失时鉴权路由会按设计直接抛错（fail-loud）。');
    console.error('  注入：openssl rand -hex 32  然后  npx wrangler secret put JWT_SECRET');
    process.exit(1);
  }
  console.log('  ✓ JWT_SECRET 已配置');
  console.log('✓ 预检通过');
}

if (process.env.SKIP_PREFLIGHT !== '1') {
  preflight();
} else {
  console.log('! 已按 SKIP_PREFLIGHT=1 跳过部署预检');
}

console.log('→ 构建 OpenNext Worker');
const build = spawnSync(BUILD_BIN, ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: path.resolve(__dirname, '..'),
});
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('→ wrangler deploy（Worker：warm-journey）');
const r = spawnSync(process.execPath, [WRANGLER_BIN, 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
});
process.exit(r.status ?? 1);
