// OpenNext Worker 自定义入口（官方 custom-worker 模式，见
// https://opennext.js.org/cloudflare/howtos/custom-worker）。
// OpenNext 生成的 worker 只有 fetch handler；本文件复用其 fetch 并附加
// scheduled（Cron Trigger）handler，把 gc.sql 的台账清理真正定时化——
// next-on-pages 没有 scheduled 能力，这是批次 9 迁移的欠账（P2-15）。
// wrangler.toml 的 main 指向本文件。
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as openNextWorker } from "../.open-next/worker.js";

import { expireStaleVisits } from "./lib/db";

// 台账清理（原 src/lib/db/gc.sql 的两条 DELETE 内联于此，单一来源）：
//  - uploads：保留 30 天（上报引用图片的最长合理窗口远小于此）
//  - ai_rate：保留 7 天，与 db/index.ts checkRateLimit 内联清理同窗口
//    （两处窗口必须一致，否则一边删一边留）
const GC_UPLOADS = "DELETE FROM uploads WHERE created_at < unixepoch() - 30 * 86400";
const GC_AI_RATE = "DELETE FROM ai_rate WHERE window_start < unixepoch() - 7 * 86400";

export default {
  fetch: openNextWorker.fetch,
  // 每天 UTC 03:00 跑（见 wrangler.toml [triggers]）。读路径的懒清理
  // （expireStaleVisits 在 getOccupancy / getAdminStats 等处的调用）保留不动：
  // 占用与统计数字需要即时的过期语义，Cron 只是低流量时段的兜底，二者互补。
  async scheduled(_event: ScheduledController, env: CloudflareEnv) {
    await env.DB.batch([
      env.DB.prepare(GC_UPLOADS),
      env.DB.prepare(GC_AI_RATE),
    ]);
    await expireStaleVisits(env.DB);
  },
} satisfies ExportedHandler<CloudflareEnv>;
