// D1 结构契约的唯一清单：migrate.cjs 按它补列，deploy.cjs 按它做部署预检。
// 此前两处各抄一份，新增列时漏改一边就会"先发代码后跑迁移"打穿成线上 500。
// 库名/项目名从 wrangler.toml 读，不再第三处硬编码。
const fs = require('fs');
const path = require('path');

const toml = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');
const pick = (re, fallback) => (toml.match(re) || [])[1] || fallback;

const DB_NAME = process.env.D1_DATABASE || pick(/^database_name\s*=\s*"([^"]+)"/m, 'warm-journey-db');
const PAGES_PROJECT = process.env.PAGES_PROJECT || pick(/^name\s*=\s*"([^"]+)"/m, 'warm-journey');
// OAuth token 关联多个账户时，非交互的 Pages 命令需要靠这个值消歧（见 deploy.cjs 的 cwd 绕法）
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || pick(/^account_id\s*=\s*"([^"]+)"/m, '');
const SCHEMA_FILE = path.join(__dirname, '..', 'src', 'lib', 'db', 'schema.sql');

// [标签, 存在性探测语句, 缺失时的修复 DDL]
// 只有 ADD COLUMN 需要手写探测——SQLite 没有 ADD COLUMN IF NOT EXISTS；
// 表与索引在 schema.sql 里都是 IF NOT EXISTS，直接重跑该文件即可。
const REQUIRED_COLUMNS = [
  ['reports.query_code',
    'SELECT query_code FROM reports LIMIT 0;',
    'ALTER TABLE reports ADD COLUMN query_code TEXT;'],
  ['point_confirms.rider_token',
    'SELECT rider_token FROM point_confirms LIMIT 0;',
    'ALTER TABLE point_confirms ADD COLUMN rider_token TEXT;'],
  ['visits.created_ip',
    'SELECT created_ip FROM visits LIMIT 0;',
    'ALTER TABLE visits ADD COLUMN created_ip TEXT;'],
  ['visits.checkin_code',
    'SELECT checkin_code FROM visits LIMIT 0;',
    'ALTER TABLE visits ADD COLUMN checkin_code TEXT;'],
];

// 表级硬依赖：缺表由 schema.sql 的 CREATE TABLE IF NOT EXISTS 补，这里只负责发现
const REQUIRED_TABLES = [
  ['uploads 台账表', 'SELECT key, ip FROM uploads LIMIT 0;'],
];

// 补列后必须回填的存量行，否则旧数据在新列上是死值。
// 与 10.7 里删掉的"旧查询码兼容分支"同源，所以 reports.query_code 不再回填旧形态：
// 老上报本来就没有可用查询码，回填 16 位 hex 前 10 位反而会被 10 位校验放行成错误数据。
// 入店码只回填 reserved：L6 之后 in_store 行的 checkin_code 为 NULL 是**正常形状**
// （确认入店时同条 UPDATE 清码），一起回填等于给已在店的人重发一张用不掉的码。
const BACKFILL_AFTER_ADD = [
  ['回填入店码（未到店的预约）',
    "UPDATE visits SET checkin_code = lower(hex(randomblob(5))) WHERE checkin_code IS NULL AND status = 'reserved';"],
];

module.exports = { DB_NAME, PAGES_PROJECT, ACCOUNT_ID, SCHEMA_FILE, REQUIRED_COLUMNS, REQUIRED_TABLES, BACKFILL_AFTER_ADD };
