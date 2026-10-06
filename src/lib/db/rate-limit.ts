import { unixNow } from './helpers';

// ---------- 限流（固定窗口 + 上一窗口加权，等效滑动窗口，消除交界处 2 倍突刺） ----------

export async function checkRateLimit(
  db: D1Database,
  key: string,
  opts: { limit?: number; windowSec?: number } = {},
): Promise<boolean> {
  const { limit = 20, windowSec = 60 } = opts;
  const now = unixNow();
  const curStart = Math.floor(now / windowSec) * windowSec;
  const prevStart = curStart - windowSec;
  const elapsed = (now - curStart) / windowSec;
  await db.prepare(
    `INSERT INTO ai_rate (ip, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1`,
  ).bind(key, curStart).run();
  const rows = await db.prepare(
    'SELECT window_start, count FROM ai_rate WHERE ip = ? AND window_start IN (?, ?)',
  ).bind(key, curStart, prevStart).all<{ window_start: number; count: number }>();
  // 顺手清理旧窗口：保留 7 天，确保 86400s 窗口的"上一窗口"行不被提前删掉
  // （否则每日限流退化为固定窗口，日界处可短时 2 倍）
  // 概率摊销：`now % 60 === 0` 只在整秒恰好落在 60 的倍数那一秒才触发，是"近似随机"
  // 而非均摊——请求时刻与秒对齐无关，多数窗口一次都不清理。gc.sql 是同窗口的周期兜底。
  if (Math.random() < 1 / 60) {
    await db.prepare('DELETE FROM ai_rate WHERE window_start < ?').bind(now - 7 * 86400).run();
  }
  const cur = rows.results?.find((r) => r.window_start === curStart)?.count ?? 0;
  const prev = rows.results?.find((r) => r.window_start === prevStart)?.count ?? 0;
  const effective = prev * (1 - elapsed) + cur;
  return effective <= limit;
}
