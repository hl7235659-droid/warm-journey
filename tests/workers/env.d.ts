// 测试用例的 ambient 类型：cloudflare:test 模块、Cloudflare.Env 与本仓库 env 的合并、?raw 导入。
// 生产 tsconfig 的 types 只列了 @cloudflare/workers-types，这里按需补三样，不改全局配置。
/// <reference types="@cloudflare/vitest-pool-workers/types" />

// env.DB / env.JWT_SECRET 的类型来源即 src/env.d.ts 的全局 CloudflareEnv
declare namespace Cloudflare {
  interface Env extends CloudflareEnv {}
}

// Vite 的 ?raw 导入：把 src/lib/db/schema.sql 原文当字符串拿进 worker（建库用）
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
