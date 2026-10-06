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

// ── 安全响应头（M2）─────────────────────────────────────────────
// 站点没有 middleware，页面与 API 唯一必经的出口就是这里，故在此收口。
// 静态资产由 Workers 资产层直出、不进 handler（缓存规则见 public/_headers）；
// /api/images 路由自己带 nosniff，所以资产侧的空白可接受。

// Google Fonts：globals.css 顶部 @import 的是 fonts.googleapis.com 的样式表，
// 样式里再引 fonts.gstatic.com 的字体文件——两条链路分别落在 style-src 与 font-src，
// 少一个就会把书法标题（Ma Shan Zheng 等）打成回退字体。
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

const CSP_POLICY = [
  "default-src 'self'",
  // Next 水合脚本与国风版式的内联样式在产物里就是 inline 的，去掉即白屏。
  // cloudflareinsights 不在仓库里：它是 Cloudflare 后台 Web Analytics(RUM) 往 HTML 里
  // 注入的 beacon.min.js，观察期唯一命中的违规就是它——不放开则转 enforce 后统计静默断掉。
  `script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com`,
  `style-src 'self' 'unsafe-inline' ${GOOGLE_FONTS_CSS}`,
  `font-src 'self' data: ${GOOGLE_FONTS_FILES}`,
  // data: 给二维码兜底（见 src/components/qr.tsx）；https: 给 R2 图片与外链封面
  "img-src 'self' data: https:",
  // https: 是产品功能：BYOK 自定义提供商由用户自填任意 https 域（决策 D2），
  // 收成白名单会直接打断「用自己的 Key」这条链路。服务端 SSRF 另有 fetch.ts 的域白名单。
  "connect-src 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // 只用定位（首页/详情页/AI 上下文），不碰摄像头与麦克风
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)",
  // 观察期：只报告不拦截（违规进浏览器控制台）。四页零违规、跑满一个部署周期后，
  // 把键名改成 Content-Security-Policy 即转 enforce，策略正文不动。
  "Content-Security-Policy-Report-Only": CSP_POLICY,
};

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  // body 直接透传：AI 聊天的流式响应不能被提前读完
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    // 以方法形式调用，保留 openNextWorker 作为 this
    return withSecurityHeaders(await openNextWorker.fetch(request, env, ctx));
  },
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
