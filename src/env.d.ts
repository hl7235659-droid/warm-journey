/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    JWT_SECRET: string;
    NEXT_PUBLIC_APP_URL: string;
    // AI 演示兜底提供商（Pages 环境变量配置，可选；用户 localStorage 里的 provider 优先）
    AI_BASE_URL?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
    // 和风天气（可选；无 key 时走 wttr.in 免费端点）
    WEATHER_API_KEY?: string;
  }
}

export {};
