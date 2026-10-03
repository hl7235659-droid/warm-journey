/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    JWT_SECRET: string;
    NEXT_PUBLIC_APP_URL: string;
  }
}

export {};
