-- 一次性 D1 变更（2026-10-06，批次 7）：删除全链路零读取的死列 + 前缀冗余索引。
-- 与 schema.sql 的差别是单向的：schema.sql 只能"补齐缺的列"，删不掉已存在的列，
-- 所以这份文件不能靠重跑 schema.sql 替代；执行完毕即从工作区退场（留档在 git 历史）。
--
-- 执行前探针（生产库 87ee3b36-9356-4ff2-9f0b-210b... 实测全部为 0，已确认无历史数据依赖）：
--   SELECT COUNT(*) FROM service_points WHERE qr_code_url IS NOT NULL AND qr_code_url != '';  -- 0
--   SELECT COUNT(*) FROM service_points WHERE verified_by IS NOT NULL;                          -- 0
--   SELECT COUNT(*) FROM inspections WHERE findings IS NOT NULL AND findings != '[]';           -- 0
--   SELECT COUNT(*) FROM work_orders WHERE assigned_to IS NOT NULL;                             -- 0
--   SELECT COUNT(*) FROM point_history WHERE change_summary != '管理员更新';                     -- 0（表本身 0 行）
--
-- 执行：npx wrangler d1 execute warm-journey-db --local  --file=src/lib/db/migrate-20261006-drop-dead-columns.sql
--       npx wrangler d1 execute warm-journey-db --remote --file=src/lib/db/migrate-20261006-drop-dead-columns.sql
-- 恢复：wrangler d1 time-travel restore（书签见批次 7 回写）或导入 ../d1-backup-20261006.sql。
--
-- 注：work_orders.assigned_name 不在这份文件里——它是 listWorkOrders/getWorkOrder 里
-- `au.display_name as assigned_name` 的 JOIN 别名，不是列（修复计划原 SQL 的笔误）。

ALTER TABLE service_points DROP COLUMN qr_code_url;
ALTER TABLE service_points DROP COLUMN verified_by;
ALTER TABLE inspections DROP COLUMN findings;
ALTER TABLE work_orders DROP COLUMN assigned_to;
ALTER TABLE point_history DROP COLUMN change_summary;

-- P3-34：idx_confirms_point(point_id) 是 idx_confirms_token(point_id, rider_token, created_at)
-- 的最左前缀，单独存在只是给写路径多维护一棵树。
DROP INDEX IF EXISTS idx_confirms_point;
