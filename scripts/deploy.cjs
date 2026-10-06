// Cloudflare Pages 部署入口：部署前做硬性预检，避免"先发代码后跑迁移/漏配密钥"导致线上 500。
// 用法：DEPLOY_BRANCH=preview-1 npm run pages:deploy
//       SKIP_PREFLIGHT=1 npm run pages:deploy   （仅在你确认预检不适用于本次预览时用）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DB_NAME, PAGES_PROJECT, ACCOUNT_ID, REQUIRED_COLUMNS, REQUIRED_TABLES } = require('./db-objects.cjs');

const branch = process.env.DEPLOY_BRANCH || 'main';
const project = PAGES_PROJECT;
const db = DB_NAME;
const OUTPUT_DIR = path.resolve(__dirname, '..', '.vercel', 'output', 'static');
// 直接点名仓库里的 wrangler：pages 命令要在仓库外的 cwd 跑，那时 npx 从 cwd 往上找不到
// 本地 node_modules/.bin，会去注册表现场拉一个新 wrangler。
const WRANGLER_BIN = path.resolve(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

// `wrangler pages *` 会校验"发现的"配置文件，而 wrangler 4.147 对 Pages 项目配置里的
// account_id 直接报错退出（`does not support "account_id"`），可从仓库里删掉 account_id
// 又会让 d1 命令回到多账户歧义。所以：d1 命令留在仓库 cwd（读得到 account_id），
// pages 命令改在仓库外的空 cwd 里跑，账户用 CLOUDFLARE_ACCOUNT_ID 显式传给那两次调用。
function runWrangler(args, { encoding = 'utf8', cwd = null } = {}) {
  const [, ...rest] = args;
  return spawnSync(process.execPath, [WRANGLER_BIN, ...rest], {
    encoding,
    stdio: encoding ? 'pipe' : 'inherit',
    cwd: cwd ?? undefined,
    env: cwd ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID } : process.env,
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

  console.log('→ 预检 2/2：JWT_SECRET 是否已作为 Pages secret 注入');
  // 注意：wrangler pages secret list 只支持 --project-name（secrets 为项目级，
  // 不分 branch），传 --branch 会直接打印帮助并以非零码退出。
  const secrets = runWrangler(['wrangler', 'pages', 'secret', 'list', '--project-name', project], { cwd: os.tmpdir() });
  const text = `${secrets.stdout ?? ''}${secrets.stderr ?? ''}`;
  if (secrets.status !== 0) {
    console.error('✗ 无法读取 Pages secret 列表（wrangler 未登录或项目不存在）：');
    console.error(text.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
  if (!/\bJWT_SECRET\b/.test(text)) {
    console.error('✗ 缺少 JWT_SECRET。缺失时鉴权路由会按设计直接抛错（fail-loud）。');
    console.error(`  注入：openssl rand -hex 32  然后  npx wrangler pages secret put JWT_SECRET --project-name=${project}`);
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

console.log(`→ 部署 ${OUTPUT_DIR} → 分支 ${branch}`);
const r = spawnSync(process.execPath,
  [WRANGLER_BIN, 'pages', 'deploy', OUTPUT_DIR, '--project-name', project, `--branch=${branch}`],
  {
    stdio: 'inherit',
    cwd: os.tmpdir(),
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
  },
);
process.exit(r.status ?? 1);
