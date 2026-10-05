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

// 依赖版本闸：1.13.10 同时缺两样东西——__import_unsupported 运行时守卫（同 isolate 内
// 第二个起加载的路由 500）与 `/` → index 的路由映射（首页返回纯文本 "Not Found"）。
// 两者都会让站点"看起来在跑、其实首页是坏的"，所以纯净 npm ci 装回旧版时必须当场失败。
const MIN_NOP_VERSION = '1.13.16';
function verifyNextOnPagesVersion() {
  const pkgPath = path.join(root, 'node_modules', '@cloudflare', 'next-on-pages', 'package.json');
  let ver = 'unknown';
  try {
    ver = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  } catch { /* 未安装时由后面的补丁步骤报错 */ }
  const cmp = (a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  if (ver === 'unknown' || cmp(ver, MIN_NOP_VERSION) < 0) {
    console.error(
      `\n✗ @cloudflare/next-on-pages 实装版本 ${ver}，本项目要求 >= ${MIN_NOP_VERSION}。\n` +
      '  旧版会同时丢失运行时守卫与首页路由映射（2026-10-05 生产事故的第二半）。\n' +
      `  修复：npm install --save-exact @cloudflare/next-on-pages@${MIN_NOP_VERSION}\n` +
      '  若确要升级更高版本，改本文件后必须重跑冒烟并核对 `GET /` 返回 text/html。',
    );
    process.exit(1);
  }
  console.log(`✓ next-on-pages 版本 ${ver}（要求 >= ${MIN_NOP_VERSION}）`);
}
verifyNextOnPagesVersion();

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
    // 补丁按压缩后源码精确匹配，发版即失配：失败提示附上当前安装版本便于排查
    let ver = 'unknown';
    try {
      ver = JSON.parse(fs.readFileSync(
        path.join(root, 'node_modules', '@cloudflare', 'next-on-pages', 'package.json'), 'utf8',
      )).version;
    } catch { /* ignore */ }
    console.error(
      '\n✗ 无法定位 next-on-pages 的 npm 版本检查代码（CLI 版本可能已更新），\n' +
      `  当前安装版本：@cloudflare/next-on-pages@${ver}（锁定版本为 1.13.16，勿降回 1.13.10），\n` +
      '  请检查 node_modules/@cloudflare/next-on-pages/dist/index.js 中的 f2 函数。',
    );
    process.exit(1);
  }
  src = src.replace(raw, patched);
  fs.writeFileSync(target, src);
  console.log('✓ 已修补 next-on-pages 的 npm 版本检查（Windows npm.cmd spawn 兼容）');
}

// next-on-pages 必须锁 1.13.16，不要降回 1.13.10。1.13.10 相对 1.13.16 缺两处能力，
// 且两处都不是"构建脚本补一下"就能等价还原的：
//  1) _worker.js 模板里的两个运行时守卫（1.13.16 起内置）：
//     a. __import_unsupported 的 defineProperty 幂等保护——Pages 把所有函数跑在同一
//        个 isolate，几十个路由包会重复执行同一段 defineProperty(globalThis,...)，
//        无守卫时第二个起即抛 "TypeError: Cannot redefine property: __import_unsupported"
//        （2026-10-05 生产 500 事故根因，仅首个被加载的路由可用）。
//     b. PatchedAbortController——规避 Next.js 在 global scope 构造 AbortController
//        被 workerd 以 "Disallowed operation called within global scope" 拒绝。
//  2) 根路径 `/` → index 函数的路由映射。1.13.10 生成的路由表里，除 RSC 分支外没有
//     任何一条把 `/` 指向 /index，请求落到资产层后返回纯文本 "Not Found"（HTTP 200、
//     9 字节），而 /index 与其余全部页面正常——即首页整页不可访问。
// 历史部署一直正常，是因为当时 node_modules 实为 1.13.16；2026-10-05 21:25 一次
// npm install 按 lockfile 把它降回 1.13.10，守卫随之消失（首页 404 同期出现，
// 但当时只修了守卫）。npm install 随时可能再次洗掉本补丁，故每次构建前自愈式补回；
// 模板结构变化（升级 next-on-pages）时锚点失配 → fail-loud，绝不静默带病出包。
// 出包后请跑 scripts/smoke-routes.cjs，并额外核对 `GET /` 返回 text/html。
const TEMPLATE_GUARD_LINES = [
  'const originalDefineProperty = Object.defineProperty;',
  '',
  'const patchedDefineProperty = (',
  '\t...args: Parameters<typeof Object.defineProperty<unknown>>',
  ') => {',
  '\tconst target = args[0];',
  '\tconst key = args[1];',
  '\t// Next.js defined an __import_unsupported global property as non configurable',
  '\t// with next-on-pages this apps try to re-define this property multiple times,',
  '\t// so here we patch `defineProperty` to just ignore re-definition of such property',
  "\tconst importUnsupportedKey = '__import_unsupported';",
  '\tif (key === importUnsupportedKey) {',
  '\t\tif (',
  "\t\t\ttypeof target === 'object' &&",
  '\t\t\ttarget !== null &&',
  '\t\t\timportUnsupportedKey in target',
  '\t\t) {',
  '\t\t\treturn;',
  '\t\t}',
  '\t}',
  '\treturn originalDefineProperty(...args);',
  '};',
  '',
  'globalThis.Object.defineProperty =',
  '\tpatchedDefineProperty as typeof globalThis.Object.defineProperty;',
  '',
  'globalThis.AbortController = class PatchedAbortController extends (',
  '\tAbortController',
  ') {',
  '\tconstructor() {',
  '\t\ttry {',
  '\t\t\tsuper();',
  '\t\t} catch (e) {',
  '\t\t\tif (',
  '\t\t\t\te instanceof Error &&',
  "\t\t\t\te.message.includes('Disallowed operation called within global scope')",
  '\t\t\t) {',
  '\t\t\t\t// Next.js attempted to create an AbortController in the global scope',
  '\t\t\t\t// let\'s return something that looks like an AbortController but with',
  '\t\t\t\t// noop functionalities',
  '\t\t\t\treturn {',
  '\t\t\t\t\tsignal: {',
  '\t\t\t\t\t\taborted: false,',
  '\t\t\t\t\t\treason: null,',
  '\t\t\t\t\t\tonabort: () => {',
  '\t\t\t\t\t\t\t/* empty */',
  '\t\t\t\t\t\t},',
  '\t\t\t\t\t\tthrowIfAborted: () => {',
  '\t\t\t\t\t\t\t/* empty */',
  '\t\t\t\t\t\t},',
  '\t\t\t\t\t} as unknown as AbortSignal,',
  '\t\t\t\t\tabort() {',
  '\t\t\t\t\t\t/* empty */',
  '\t\t\t\t\t},',
  '\t\t\t\t};',
  '\t\t\t} else {',
  '\t\t\t\t\tthrow e;',
  '\t\t\t\t}',
  '\t\t\t}',
  '\t\t}',
  '};',
];

function patchNextOnPagesTemplateGuard() {
  const target = path.join(
    root, 'node_modules', '@cloudflare', 'next-on-pages', 'templates', '_worker.js', 'index.ts',
  );
  if (!fs.existsSync(target)) {
    console.error('\n✗ node_modules/@cloudflare/next-on-pages 未安装，请先 npm install');
    process.exit(1);
  }
  let src = fs.readFileSync(target, 'utf8');
  if (src.includes('const originalDefineProperty = Object.defineProperty;')) {
    console.log('✓ next-on-pages 模板 __import_unsupported 守卫已存在');
    return;
  }
  const anchor = 'export default {';
  const first = src.indexOf(anchor);
  if (first === -1 || src.indexOf(anchor, first + 1) !== -1) {
    let ver = 'unknown';
    try {
      ver = JSON.parse(fs.readFileSync(
        path.join(root, 'node_modules', '@cloudflare', 'next-on-pages', 'package.json'), 'utf8',
      )).version;
    } catch { /* ignore */ }
    console.error(
      '\n✗ 无法在 next-on-pages 模板中定位唯一锚点 "export default {"\n' +
      `  当前安装版本：@cloudflare/next-on-pages@${ver}（锁定版本为 1.13.16，勿降回 1.13.10）。\n` +
      '  模板结构可能已变化，请人工核对 scripts/build-pages.cjs 的守卫补丁后再构建。',
    );
    process.exit(1);
  }
  src = src.slice(0, first) + TEMPLATE_GUARD_LINES.join('\n') + '\n\n' + src.slice(first);
  fs.writeFileSync(target, src);
  console.log('✓ 已补回 next-on-pages 模板的 __import_unsupported 幂等守卫（上游 1.13.16 同款）');
}

// 出包前最后一道闸：编译产物里必须能看到守卫字符串，否则拒绝出包。
// 守卫编译进 _worker.js/index.js 后，字符串字面量 '__import_unsupported' 会在；
// 无守卫的产物该文件不含此字符串（2026-10-05 坏构建 16cea6eb 实测为证）。
function verifyWorkerImportGuard() {
  const entry = path.join(root, '.vercel', 'output', 'static', '_worker.js', 'index.js');
  if (!fs.existsSync(entry) || !fs.readFileSync(entry, 'utf8').includes('__import_unsupported')) {
    console.error(
      '\n✗ 编译产物 _worker.js/index.js 缺少 __import_unsupported 幂等守卫。\n' +
      '  这样的包部署后，同一 isolate 内第二个及以后加载的路由会 500\n' +
      '  （TypeError: Cannot redefine property: __import_unsupported）。已拒绝出包。\n' +
      '  排查：node_modules/@cloudflare/next-on-pages/templates/_worker.js/index.ts\n' +
      '  是否被 npm install 洗掉守卫、且 scripts/build-pages.cjs 补丁步骤是否执行。',
    );
    process.exit(1);
  }
  console.log('✓ 编译产物包含 __import_unsupported 幂等守卫');
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
patchNextOnPagesTemplateGuard();
run('next-on-pages', 'npx', ['@cloudflare/next-on-pages', '--skip-build']);
verifyWorkerImportGuard();

console.log('\n✓ Pages build ready in .vercel/output/static');
