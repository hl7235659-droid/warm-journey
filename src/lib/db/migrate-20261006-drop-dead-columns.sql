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
-- ⚠️ 执行状态（2026-10-06）：
--   * 本机 --local：已全部执行并核对（PRAGMA table_info 五列均已消失）。
--   * 生产 --remote：只执行了最后的 DROP INDEX idx_confirms_point（对 SQL 语义透明，
--     新老代码都不受影响）。下面 5 条 DROP COLUMN **必须在"含批次 7 的新构建部署到生产之后"**
--     再执行——生产当前在跑的是 31a5d91（批次 1/2 时代），它的 db/index.ts 仍把这五列
--     写进 INSERT/UPDATE/JOIN：先删列会让管理端新建/编辑点位、新建工单、工单列表、
--     新建巡检全部报 "no such column" 而 500。
--   * 反过来是安全的：这五列要么可空、要么有 DEFAULT，新代码的 INSERT 一律显式列表，
--     读取又走 deserializePoint 的显式挑字段，所以"新代码 + 未删列的老库"完全正常。
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
