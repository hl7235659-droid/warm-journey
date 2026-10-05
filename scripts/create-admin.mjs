// 一次性创建管理员账号（替代旧 seed 中的 admin/admin123 硬编码账户）。
//
// 本地：  npm run admin:create
// 生产：  ADMIN_USERNAME=ops ADMIN_PASSWORD='强密码' npm run admin:create -- --remote
//
// 密码来源优先级：环境变量 ADMIN_PASSWORD → 交互式输入（本地）。
// 密码哈希在本机用 bcryptjs 计算，SQL 只包含哈希，明文不落任何文件。
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import { stdin, stdout, exit, env, argv } from 'node:process';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const remote = argv.includes('--remote');
const username = (env.ADMIN_USERNAME || 'admin').trim();
const role = (env.ADMIN_ROLE || 'super_admin').trim();
if (!['super_admin', 'admin', 'inspector'].includes(role)) {
  console.error(`✗ 非法角色：${role}（仅限 super_admin / admin / inspector）`);
  exit(1);
}

let password = env.ADMIN_PASSWORD || '';
if (!password) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  // readline.question 会回显输入；如需避免，请改用 ADMIN_PASSWORD 环境变量
  console.log('提示：交互式输入会显示在屏幕上，共享环境请改用 ADMIN_PASSWORD 环境变量。');
  password = await rl.question(`为「${username}」设置密码（至少 8 位）: `);
  rl.close();
}
if (password.length < 8) {
  console.error('✗ 密码至少 8 位');
  exit(1);
}

// 这些值会拼进 --command 参数并经 shell 执行，必须挡住 shell 元字符
const SAFE_FIELD = /^[\w\u4e00-\u9fa5 .\-·]{1,32}$/;
const display = env.ADMIN_DISPLAY_NAME || '系统管理员';
for (const [name, value] of [['ADMIN_USERNAME', username], ['ADMIN_DISPLAY_NAME', display]]) {
  if (!SAFE_FIELD.test(value)) {
    console.error(`✗ ${name} 含非法字符（仅允许中英文、数字、下划线、空格、. - ·）：${value}`);
    exit(1);
  }
}

const hash = bcrypt.hashSync(password, 10);
const sql =
  `INSERT INTO admin_users (id, username, password_hash, role, display_name, created_at, updated_at) ` +
  `VALUES (lower(hex(randomblob(8))), '${username.replace(/'/g, "''")}', '${hash.replace(/'/g, "''")}', ` +
  `'${role}', '${display.replace(/'/g, "''")}', unixepoch(), unixepoch());`;

const args = ['wrangler', 'd1', 'execute', 'warm-journey-db', '--command', sql, '-y'];
if (remote) args.push('--remote');
else args.push('--local');

console.log(`→ 正在${remote ? '（远程）' : '（本地）'}创建管理员「${username}」…`);
const { spawnSync } = await import('node:child_process');
const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) {
  console.error('✗ 创建失败（用户名可能已存在，或 wrangler 未登录）');
  exit(r.status ?? 1);
}
console.log(`✓ 管理员「${username}」创建完成。请妥善保管密码，切勿入库明文。`);
