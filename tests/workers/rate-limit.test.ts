// 7-2 · 限流三连 batch 化（L9）的护栏：
//   ① 批量版 checkRateLimits 与单条版判定同口径（滑动窗口），各 key 相互独立；
//   ② 单条版 checkRateLimit（登录/预约/上报等十余处调用方）委托批量实现后行为不变。
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkRateLimit, checkRateLimits } from '@/lib/db';
import { applySchema } from './_helpers';

beforeAll(async () => {
  await applySchema();
});

describe('checkRateLimits（batch 化）', () => {
  it('同批判定各 key 独立：各 key 只认自己的计数与限额，互不干扰', async () => {
    // 窗口取 1 小时：四次调用必然落在同一窗口内，滑动窗口的 prev 项恒为 0，
    // 判定退化为 count <= limit，结果与执行时刻无关（用例不在窗口交界处抖动）。
    // 注意批量版每次调用给批内每个 key 各 +1：a limit=2 第 3 次超限、b limit=3 第 4 次才超限，
    // 以此证明 a 的超限不会波及 b（不同 key 各自独立计数）。
    const a = `rl-batch-a-${Date.now()}`;
    const b = `rl-batch-b-${Date.now()}`;
    const call = () => checkRateLimits(env.DB, [
      { key: a, limit: 2, windowSec: 3600 },
      { key: b, limit: 3, windowSec: 3600 },
    ]);
    expect(await call()).toEqual([true, true]);
    expect(await call()).toEqual([true, true]);
    expect(await call()).toEqual([false, true]);
    expect(await call()).toEqual([false, false]);
  });

  it('空批次直接返回空数组，不产生往返', async () => {
    expect(await checkRateLimits(env.DB, [])).toEqual([]);
  });
});

describe('checkRateLimit（单条版，委托批量实现）', () => {
  it('判定口径不变：第 1 次 true，同窗口第 2 次超限 false', async () => {
    const key = `rl-single-${Date.now()}`;
    expect(await checkRateLimit(env.DB, key, { limit: 1, windowSec: 3600 })).toBe(true);
    expect(await checkRateLimit(env.DB, key, { limit: 1, windowSec: 3600 })).toBe(false);
  });
});
