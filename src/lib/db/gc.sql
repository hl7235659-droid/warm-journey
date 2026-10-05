-- 台账/限流表周期清理（配合 R2 生命周期规则使用）
-- 本地：npm run db:gc        远程：npm run db:gc:prod
-- R2 里未被引用的 img/ 对象需另配生命周期规则：
--   npx wrangler r2 bucket lifecycle add warm-journey-images --rule 'orphans --prefix "img/" --age 30'
--   （或在 Cloudflare 控制台 R2 → Bucket → Lifecycle rules 配置）

-- 上传台账：保留 30 天（上报引用图片的最长合理窗口远小于此）
DELETE FROM uploads WHERE created_at < unixepoch() - 30 * 86400;

-- 限流计数：保留 8 天（够覆盖 86400s 窗口的上一窗口加权）
DELETE FROM ai_rate WHERE window_start < unixepoch() - 8 * 86400;
