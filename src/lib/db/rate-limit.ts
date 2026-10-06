import { unixNow } from './helpers';

// ---------- 限流（固定窗口 + 上一窗口加权，等效滑动窗口，消除交界处 2 倍突刺） ----------

// 批量版的一条限额。各条目的 key 相互独立，合批执行不影响各自的窗口与判定语义。
export interface RateLimitCheck {
  key: string;
  limit?: number;
  windowSec?: number;
}

// 批量判定：多条限额合并为一次 db.batch 往返（chat 路由的分钟/日/全站三连曾是三次串行往返，
// 每条各含 INSERT + SELECT）。语句顺序：全部 INSERT → 全部 SELECT → （概率触发的）GC DELETE，
// 读自己那次写与单条版一致，GC 仍在读取之后、不影响本次判定。
// 顺手清理旧窗口：保留 7 天，确保 86400s 窗口的"上一窗口"行不被提前删掉
// （否则每日限流退化为固定窗口，日界处可短时 2 倍）。
// 概率摊销：`now % 60 === 0` 只在整秒恰好落在 60 的倍数那一秒才触发，是"近似随机"
// 而非均摊——请求时刻与秒对齐无关，多数窗口一次都不清理。gc.sql 是同窗口的周期兜底。
// 批量版整批只掷一次骰子（单条版是每条一次），清理频率同一量级。
export async function checkRateLimits(db: D1Database, checks: RateLimitCheck[]): Promise<boolean[]> {
  if (checks.length === 0) return [];
  const now = unixNow();
  const windows = checks.map((c) => {
    const { limit = 20, windowSec = 60 } = c;
    const curStart = Math.floor(now / windowSec) * windowSec;
    return {
      limit,
      curStart,
      prevStart: curStart - windowSec,
      elapsed: (now - curStart) / windowSec,
    };
  });

  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < checks.length; i++) {
    stmts.push(
      db.prepare(
        'INSERT INTO ai_rate (ip, window_start, count) VALUES (?, ?, 1) ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1',
      ).bind(checks[i].key, windows[i].curStart),
    );
  }
  for (let i = 0; i < checks.length; i++) {
    stmts.push(
      db.prepare('SELECT window_start, count FROM ai_rate WHERE ip = ? AND window_start IN (?, ?)')
        .bind(checks[i].key, windows[i].curStart, windows[i].prevStart),
    );
  }
  if (Math.random() < 1 / 60) {
    stmts.push(db.prepare('DELETE FROM ai_rate WHERE window_start < ?').bind(now - 7 * 86400));
  }

  const results = await db.batch(stmts);
  return windows.map((w, i) => {
    const rows = (results[checks.length + i].results ?? []) as Array<{ window_start: number; count: number }>;
    const cur = rows.find((r) => r.window_start === w.curStart)?.count ?? 0;
    const prev = rows.find((r) => r.window_start === w.prevStart)?.count ?? 0;
    return prev * (1 - w.elapsed) + cur <= w.limit;
  });
}

// 单条版保留原签名（登录/预约/上报/上传等十余处调用方）；实现委托批量版，判定口径只有一份。
export async function checkRateLimit(
  db: D1Database,
  key: string,
  opts: { limit?: number; windowSec?: number } = {},
): Promise<boolean> {
  const [allowed] = await checkRateLimits(db, [{ key, ...opts }]);
  return allowed;
}
