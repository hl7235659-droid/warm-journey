// One-shot build pipeline for Cloudflare Pages.
//
// Why this exists: on Windows, `vercel build` dedupes .func directories with
// fs.symlink(), which fails with EPERM (Developer Mode off / non-elevated) and
// aborts the build AFTER writing a stub .vercel/output/config.json. The stub has
// no `routes` array, so @cloudflare/next-on-pages emits a worker with an empty
// route table — every dynamic route (/point/[id], /api/**/[id]) then falls
// through to a bare "Not Found" 404 while "/" and static paths still work.
//
// The shim below makes fs.symlink fall back to a directory junction (mklink /J),
// which needs no privileges, so `vercel build` completes and writes real routes.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const shim = path.join(__dirname, 'win-symlink-shim.cjs');

// next-on-pages CLI（package-manager-manager 依赖）在启动时用 shellac 直接 spawn
// `npm --version`，Windows 上 npm 是 npm.cmd，无 shell spawn 必然 ENOENT，
// CLI 直接 exit 1。此处幂等修补 dist/index.js：失败时返回占位版本号（仅用于
// yarn classic 判定，对 npm 无影响）。npm install 后重跑本脚本会自动重新打上。
function patchNextOnPagesNpmCheck() {
  const target = path.join(root, 'node_modules', '@cloudflare', 'next-on-pages', 'dist', 'index.js');
  if (!fs.existsSync(target)) {
    console.error('\n✗ node_modules/@cloudflare/next-on-pages 未安装，请先 npm install');
    process.exit(1);
  }
  let src = fs.readFileSync(target, 'utf8');
  const raw = 'async function f2(n4) {\n  const { stdout: e2 } = await l4`$ ${n4} --version`;\n  return e2;\n}';
  const patched =
    'async function f2(n4) {\n' +
    '  try {\n' +
    '    const { stdout: e2 } = await l4`$ ${n4} --version`;\n' +
    '    return e2;\n' +
    '  } catch {\n' +
    '    return "10.0.0"; /* win-shim: npm.cmd 无法被无 shell spawn */\n' +
    '  }\n' +
    '}';
  if (src.includes('win-shim: npm.cmd')) {
    console.log('✓ next-on-pages npm 检查补丁已存在');
    return;
  }
  if (!src.includes(raw)) {
    console.error(
      '\n✗ 无法定位 next-on-pages 的 npm 版本检查代码（CLI 版本可能已更新），\n' +
      '  请检查 node_modules/@cloudflare/next-on-pages/dist/index.js 中的 f2 函数。',
    );
    process.exit(1);
  }
  src = src.replace(raw, patched);
  fs.writeFileSync(target, src);
  console.log('✓ 已修补 next-on-pages 的 npm 版本检查（Windows npm.cmd spawn 兼容）');
}

function run(label, cmd, args, env) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

run('vercel build', 'npx', ['vercel', 'build', '--yes'], {
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${shim}`].filter(Boolean).join(' '),
});

// Safety net: repair any .func symlink that still slipped through.
run('patch vercel funcs', process.execPath, [path.join(__dirname, 'patch-vercel-funcs.cjs')]);

// Guard: a stub config.json means routing will be broken — fail loudly instead of shipping.
const cfgPath = path.join(root, '.vercel', 'output', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (!Array.isArray(cfg.routes) || cfg.routes.length === 0) {
  console.error(
    `\n✗ ${path.relative(root, cfgPath)} has no routes — dynamic pages would 404.\n` +
      '  vercel build likely crashed on a symlink. Check scripts/win-symlink-shim.cjs.',
  );
  process.exit(1);
}
console.log(`\n✓ config.json contains ${cfg.routes.length} routes`);

patchNextOnPagesNpmCheck();
run('next-on-pages', 'npx', ['@cloudflare/next-on-pages', '--skip-build']);

console.log('\n✓ Pages build ready in .vercel/output/static');
