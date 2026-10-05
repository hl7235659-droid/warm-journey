/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    // 可选 + 运行时显式校验（缺失时抛错），与代码行为一致——类型即文档。
    // 部署必须先注入：npx wrangler pages secret put JWT_SECRET
    JWT_SECRET?: string;
    // AI 演示兜底提供商（Pages 环境变量配置，可选；用户 localStorage 里的 provider 优先）
    AI_BASE_URL?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
    // BYOK 出站主机名白名单追加（逗号分隔，可选）：默认只允许主流 OpenAI 兼容域名
    AI_ALLOWED_HOSTS?: string;
  }
}

export {};
