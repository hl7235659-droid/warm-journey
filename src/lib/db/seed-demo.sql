-- ⚠️⚠️ 演示数据专用 seed —— 禁止对生产库执行 ⚠️⚠️
--
-- 本文件写的是"造出来的客流"：11 条 visits（其中 demo000visit11 是 status='in_store'）
-- + 10 条 visit_feedback。误跑进生产库的后果：
--   * 该点位在店人数从此恒为 1（getOccupancy / 首页圆章 / AI 上下文全跟着错）
--   * getAdminStats 的「今日进店」「在店人数」「平均星级」被假数据污染
--   * AI 周报与口碑摘要（T1/T2/T3 演示）读到的也是这批假反馈
-- 全部 INSERT OR IGNORE，可重复执行；主键是 demo000visit*/demofdbk* 固定 id，
-- 清理时用这些 id 精确删除即可。
--
-- 本地/演示环境：npm run db:seed:demo
-- 平台基础数据（3 站点 + 1 城市 + 6 知识库，任何环境都可安全执行）见 seed.sql。

-- 演示数据：近两周到访与离店反馈（支撑 T1 客流提示 / T2 口碑摘要 / T3 AI 周报 demo）
-- checked_in_at 用 unixepoch() 相对时间，保证任何时间部署都"新鲜"；7/14 天前即同星期同时段
INSERT OR IGNORE INTO visits (id, point_id, rider_token, status, reserved_at, checked_in_at, checked_out_at, created_at)
VALUES
  ('demo000visit01', 'point001', 'decafbad00000001', 'completed', unixepoch()-7*86400-1800,  unixepoch()-7*86400,  unixepoch()-7*86400+5400, unixepoch()-7*86400-1800),
  ('demo000visit02', 'point001', 'decafbad00000002', 'completed', unixepoch()-14*86400-1800, unixepoch()-14*86400, unixepoch()-14*86400+4800, unixepoch()-14*86400-1800),
  ('demo000visit03', 'point001', 'decafbad00000003', 'completed', unixepoch()-6*86400-3600,  unixepoch()-6*86400,  unixepoch()-6*86400+3600,  unixepoch()-6*86400-3600),
  ('demo000visit04', 'point001', 'decafbad00000004', 'completed', unixepoch()-5*86400-7200,  unixepoch()-5*86400,  unixepoch()-5*86400+7200, unixepoch()-5*86400-7200),
  ('demo000visit05', 'point001', 'decafbad00000005', 'completed', unixepoch()-3*86400-1800,  unixepoch()-3*86400,  unixepoch()-3*86400+4200, unixepoch()-3*86400-1800),
  ('demo000visit06', 'point001', 'decafbad00000006', 'completed', unixepoch()-2*86400-2400,  unixepoch()-2*86400,  unixepoch()-2*86400+6000, unixepoch()-2*86400-2400),
  ('demo000visit07', 'point001', 'decafbad00000007', 'completed', unixepoch()-1*86400-1500,  unixepoch()-1*86400,  unixepoch()-1*86400+3000, unixepoch()-1*86400-1500),
  ('demo000visit08', 'point003', 'decafbad00000008', 'completed', unixepoch()-4*86400-900,   unixepoch()-4*86400,  unixepoch()-4*86400+5400, unixepoch()-4*86400-900),
  ('demo000visit09', 'point003', 'decafbad00000009', 'completed', unixepoch()-2*86400-600,   unixepoch()-2*86400,  unixepoch()-2*86400+3600, unixepoch()-2*86400-600),
  ('demo000visit10', 'point002', 'decafbad00000010', 'completed', unixepoch()-3*86400-2700,  unixepoch()-3*86400,  unixepoch()-3*86400+4500, unixepoch()-3*86400-2700),
  -- 当前在店 1 人（在店人数演示）
  ('demo000visit11', 'point001', 'decafbad00000011', 'in_store',   unixepoch()-1200,        unixepoch()-600,     NULL,                  unixepoch()-1200);

INSERT OR IGNORE INTO visit_feedback (id, visit_id, point_id, rating, supports, suggestion, created_at)
VALUES
  ('demofdbk0001', 'demo000visit01', 'point001', 5, '["充电","饮用水"]',       '充电插座很多，半小时就满了', unixepoch()-7*86400+5400),
  ('demofdbk0002', 'demo000visit02', 'point001', 4, '["充电","休息区"]',       '希望插座再多个几个就好了',   unixepoch()-14*86400+4800),
  ('demofdbk0003', 'demo000visit03', 'point001', 5, '["充电","热饭"]',         '有微波炉热饭很方便，赞',     unixepoch()-6*86400+3600),
  ('demofdbk0004', 'demo000visit04', 'point001', 4, '["休息区","法律援助"]',   '',                           unixepoch()-5*86400+7200),
  ('demofdbk0005', 'demo000visit05', 'point001', 5, '["充电","急救药品"]',     '常备药箱很实用',             unixepoch()-3*86400+4200),
  ('demofdbk0006', 'demo000visit06', 'point001', 3, '["法律援助"]',           '晚上门锁扫码反应慢，等了两分钟', unixepoch()-2*86400+6000),
  ('demofdbk0007', 'demo000visit07', 'point001', 5, '["充电","饮用水","法律援助"]', '',                     unixepoch()-1*86400+3000),
  ('demofdbk0008', 'demo000visit08', 'point003', 4, '["休息区","Wi-Fi"]',     '免费午餐好评，建议中午多备些', unixepoch()-4*86400+5400),
  ('demofdbk0009', 'demo000visit09', 'point003', 5, '["热饭","心理疏导"]',    '',                           unixepoch()-2*86400+3600),
  ('demofdbk0010', 'demo000visit10', 'point002', 4, '["停车","饮用水"]',      '停车棚晚上光线有点暗',       unixepoch()-3*86400+4500);
