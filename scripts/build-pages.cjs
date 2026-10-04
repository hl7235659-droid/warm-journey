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

const root = path.resolve(__dirname, '..');
const shim = path.join(__dirname, 'win-symlink-shim.cjs');

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
const fs = require('fs');
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

run('next-on-pages', 'npx', ['@cloudflare/next-on-pages', '--skip-build']);

console.log('\n✓ Pages build ready in .vercel/output/static');
