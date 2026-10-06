// 批次 4 · 测试地基（S3）的 vitest 配置：用例跑在真实 workerd 里，
// D1 是 Cloudflare 自带的那份 SQLite（与生产同一引擎），不是内存仿制品。
// 生产 npm test（node --test 纯函数用例）与本配置互不影响：见 package.json 的 test / test:workers。
import path from 'node:path';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.toml' } })],
  resolve: {
    // 与 tsconfig paths 的 "@/*": ["./src/*"] 保持一致，被测代码里的 import 不用改
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['tests/workers/**/*.test.ts'],
    // pool 默认 isolatedStorage=true：每个测试文件一份全新 D1/R2 存储，
    // 所以建库（applySchema）在每个文件的 beforeAll 里各跑一次。
  },
});
