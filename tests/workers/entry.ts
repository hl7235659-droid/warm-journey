// 测试 Worker 入口（wrangler.test.toml 的 main）。
// vitest-pool-workers 需要一个真实 Worker 才能起 workerd 并注入 D1/R2 绑定，
// 这里给最小空实现：用例直接在 Worker 上下文里 import 被测代码，不经这个 fetch。
export default {
  async fetch(): Promise<Response> {
    return new Response('warm-journey test harness', { status: 200 });
  },
} satisfies ExportedHandler<CloudflareEnv>;
