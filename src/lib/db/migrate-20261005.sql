-- 一次性迁移（2026-10-05 安全修复）：为已有数据库补列 / 补索引。
-- 运行一次即可：npx wrangler d1 execute warm-journey-db --remote --file=src/lib/db/migrate-20261005.sql
-- 注意：SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS——若已执行过本文件会报
-- "duplicate column name" 错误，属于预期，忽略即可。
-- 全新部署无需本文件（schema.sql 已包含全部表结构与索引）。

ALTER TABLE reports ADD COLUMN query_code TEXT;
ALTER TABLE point_confirms ADD COLUMN rider_token TEXT;
ALTER TABLE visits ADD COLUMN created_ip TEXT;
ALTER TABLE visits ADD COLUMN checkin_code TEXT;

-- 存量进行中的预约补发入店码（否则旧预约无法确认入店）
UPDATE visits SET checkin_code = lower(hex(randomblob(5)))
  WHERE checkin_code IS NULL AND status IN ('reserved','in_store');

-- 存量上报回填查询码：旧查询码即 report id 前 10 位，兼容旧行为
UPDATE reports SET query_code = substr(id, 1, 10) WHERE query_code IS NULL;

-- 上传台账：先建表再建唯一索引，避免唯一索引因存量脏数据失败时
-- 停在「列已加、表未建」的半迁移状态（/api/upload 会直接 500）
CREATE TABLE IF NOT EXISTS uploads (
  key        TEXT PRIMARY KEY,
  ip         TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_uploads_ip ON uploads(ip, created_at);

-- 并发正确性兜底索引（若存量数据有重复会在此报错——fail loud，需先人工清理）
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_active_rider
  ON visits(point_id, rider_token) WHERE status IN ('reserved','in_store');
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_report
  ON work_orders(report_id) WHERE report_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_query_code
  ON reports(query_code) WHERE query_code IS NOT NULL;

-- 查询性能补齐
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);
CREATE INDEX IF NOT EXISTS idx_confirms_token ON point_confirms(point_id, rider_token, created_at);
CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(created_ip, status) WHERE created_ip IS NOT NULL;
