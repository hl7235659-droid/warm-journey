import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 最小配置：不启用 R2 增量缓存 / DO 标签缓存（本站以动态渲染为主，
// ISR 收益小；如后续需要再按官方 caching 文档加 NEXT_INC_CACHE_R2_BUCKET）。
export default defineCloudflareConfig({});
