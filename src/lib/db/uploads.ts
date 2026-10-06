import { unixNow } from './helpers';

// ---------------------------------------------------------------------------
// 上传台账：upload 签发的 key 记账，上报引用时校验"确为本 IP 近期上传"
// ---------------------------------------------------------------------------

export async function recordUpload(db: D1Database, key: string, ip: string) {
  await db.prepare(
    'INSERT OR IGNORE INTO uploads (key, ip, created_at) VALUES (?, ?, ?)',
  ).bind(key, ip, unixNow()).run();
}

// 返回 keys 中属于该 IP 且在 withinSec 内上传的子集
export async function filterOwnedUploads(
  db: D1Database,
  keys: string[],
  ip: string,
  withinSec = 24 * 3600,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT key FROM uploads WHERE key IN (${placeholders}) AND ip = ? AND created_at >= ?`,
  ).bind(...keys, ip, unixNow() - withinSec).all<{ key: string }>();
  return new Set((rows.results ?? []).map((r) => r.key));
}
