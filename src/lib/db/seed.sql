-- 初始管理员账户（用户名 admin / 密码 admin123，生产环境请立即更换）
-- bcrypt hash of 'admin123' with salt rounds 10
INSERT OR IGNORE INTO admin_users (id, username, password_hash, role, display_name)
VALUES (
  'seed0000admin1',
  'admin',
  '$2a$10$bRv/rMI1tkybYu8TV3mYtejd.EuGzxunrYPjnzRnOhn3o2uvDaX7G',
  'super_admin',
  '系统管理员'
);

-- 示例服务点（广州大学城 / 番禺区小谷围岛）
INSERT OR IGNORE INTO service_points
  (id, name, address, lat, lng, city, district, contact_phone,
   open_hours, status, services, admission, notes, created_by)
VALUES
(
  'point001',
  '美团骑手服务站（大学城贝岗店）',
  '广州市番禺区大学城贝岗村贝岗大街12号首层',
  23.0525, 113.3790,
  '广州', '番禺区',
  '020-31234567',
  '周一至周日 07:00–23:00',
  'open',
  '["休息区","充电","饮用水","急救箱","厕所"]',
  '{"id_required":true,"capacity":20,"notes":"需出示骑手码"}',
  '二楼设有微波炉，雨天可免费借用雨衣；紧邻贝岗商业街，取餐高峰避雨方便',
  'seed0000admin1'
),
(
  'point002',
  '顺丰速运骑士驿站（大学城北站）',
  '广州市番禺区大学城小谷围街中环东路188号',
  23.0620, 113.3900,
  '广州', '番禺区',
  '020-38765432',
  '全天24小时',
  'open',
  '["休息区","充电","饮用水","Wi-Fi","停车"]',
  '{"id_required":true,"capacity":15}',
  '紧邻地铁大学城北站A口，配有热水、茶叶，停车场免费1小时',
  'seed0000admin1'
),
(
  'point003',
  '骑手联合服务中心（大学城中心湖）',
  '广州市番禺区大学城中心湖公园东侧环路6号',
  23.0520, 113.3860,
  '广州', '番禺区',
  '020-31223344',
  '周一至周五 08:00–20:00，周末 09:00–18:00',
  'open',
  '["休息区","充电","饮用水","急救箱","雨具","餐饮","Wi-Fi"]',
  '{"id_required":false,"capacity":30,"notes":"所有骑手均可使用"}',
  '免费提供午餐（11:00–13:00），需凭骑手工牌；环湖绿道可短时停车',
  'seed0000admin1'
);

-- 开通城市（示例：广州，视野中心 = 大学城）
INSERT OR IGNORE INTO cities (id, name, center_lat, center_lng, enabled)
VALUES ('city0000gz0001', '广州', 23.0525, 113.3850, 1);

-- AI 知识库初始条目（对应蓝图 T4：指引到正规渠道，AI 只引用库内条目并附出处）
INSERT OR IGNORE INTO ai_knowledge (id, category, title, content, tags, enabled, updated_at)
VALUES
(
  'knowl01chan01',
  'channel',
  '工会维权服务热线 12351',
  '全国总工会职工维权服务热线 12351，可咨询劳动权益、社保缴纳、工伤认定、欠薪讨薪等问题。工作日人工接听，也可通过"全国总工会"微信公众号在线反映。骑手与平台/站点发生用工纠纷时，可先拨打 12351 获取工会法律帮助指引。',
  '["法律援助","维权","工会","12351","欠薪","讨薪","工伤"]',
  1, unixepoch()
),
(
  'knowl02chan02',
  'channel',
  '法律援助热线与法律援助中心',
  '司法部公共法律服务热线 12348，提供免费法律咨询；符合条件的外卖骑手（新就业形态劳动者）可向工作地或常住地的法律援助中心申请免费代理。广州市法律援助处咨询电话 020-83322185。涉及劳务关系、交通事故赔偿、平台扣款争议等，建议先电话咨询再备齐材料（工牌、接单记录、银行流水）前往。',
  '["法律援助","律师","12348","咨询","纠纷","赔偿","扣款"]',
  1, unixepoch()
),
(
  'knowl03righ01',
  'rights',
  '新就业形态劳动者权益保障要点',
  '依据人社部等部门关于维护新就业形态劳动者权益的指导意见：1. 平台不得诱导或强迫骑手注册为个体工商户以规避用工责任；2. 算法派单应考虑安全因素，连续接单时长达到上限应提示休息；3. 职业伤害保障试点已覆盖出行、外卖等行业，发生职业伤害可按流程申请；4. 骑手有权加入工会组织。具体细则以当地人社部门发布为准。',
  '["权益","政策","社保","职业伤害","工会","个体工商户","算法","休息"]',
  1, unixepoch()
),
(
  'knowl04chan03',
  'channel',
  '心理疏导支持渠道',
  '如果近期感到压力大、情绪低落或烦躁难眠：1. 可拨打心理援助热线 12356（公益、免费）；2. 北京、广州等地设有 24 小时心理援助热线；3. 各级工会职工服务中心常设免费心理咨询服务，可通过 12351 转介。情绪没有对错，寻求帮助是照顾自己的方式；若出现无法自控的念头，请立即拨打热线或前往医院急诊。',
  '["心理","压力","情绪","焦虑","失眠","疏导","热线"]',
  1, unixepoch()
),
(
  'knowl05faq01',
  'faq',
  '驿站收费吗？需要什么证件？',
  '暖途同行收录的驿站均为公益性质，免费使用（个别餐饮服务按站点规定）。部分站点需出示骑手码或工牌登记，具体以站点详情页"准入要求"为准；未标注证件要求的站点可直接进入休息。',
  '["收费","免费","证件","准入","骑手码","工牌"]',
  1, unixepoch()
),
(
  'knowl06noti01',
  'notice',
  '平台数据与隐私说明',
  '暖途同行全程免注册免登录：你的预约、反馈通过本机匿名标识关联，不收集姓名和手机号；AI 助手的提供商密钥只保存在你的设备本地，不上传服务器。上报问题时请勿在文字或照片中包含他人隐私信息。',
  '["隐私","数据","匿名","免登录","安全"]',
  1, unixepoch()
);

-- 演示数据：近两周到访与离店反馈（支撑 T1 客流提示 / T2 口碑摘要 / T3 AI 周报 demo）
-- checked_in_at 用 unixepoch() 相对时间，保证任何时间部署都"新鲜"；7/14 天前即同星期同时段
INSERT OR IGNORE INTO visits (id, point_id, rider_token, status, reserved_at, checked_in_at, checked_out_at, created_at)
VALUES
  ('demo000visit01', 'point001', 'demotoken0001', 'completed', unixepoch()-7*86400-1800,  unixepoch()-7*86400,  unixepoch()-7*86400+5400, unixepoch()-7*86400-1800),
  ('demo000visit02', 'point001', 'demotoken0002', 'completed', unixepoch()-14*86400-1800, unixepoch()-14*86400, unixepoch()-14*86400+4800, unixepoch()-14*86400-1800),
  ('demo000visit03', 'point001', 'demotoken0003', 'completed', unixepoch()-6*86400-3600,  unixepoch()-6*86400,  unixepoch()-6*86400+3600,  unixepoch()-6*86400-3600),
  ('demo000visit04', 'point001', 'demotoken0004', 'completed', unixepoch()-5*86400-7200,  unixepoch()-5*86400,  unixepoch()-5*86400+7200, unixepoch()-5*86400-7200),
  ('demo000visit05', 'point001', 'demotoken0005', 'completed', unixepoch()-3*86400-1800,  unixepoch()-3*86400,  unixepoch()-3*86400+4200, unixepoch()-3*86400-1800),
  ('demo000visit06', 'point001', 'demotoken0006', 'completed', unixepoch()-2*86400-2400,  unixepoch()-2*86400,  unixepoch()-2*86400+6000, unixepoch()-2*86400-2400),
  ('demo000visit07', 'point001', 'demotoken0007', 'completed', unixepoch()-1*86400-1500,  unixepoch()-1*86400,  unixepoch()-1*86400+3000, unixepoch()-1*86400-1500),
  ('demo000visit08', 'point003', 'demotoken0008', 'completed', unixepoch()-4*86400-900,   unixepoch()-4*86400,  unixepoch()-4*86400+5400, unixepoch()-4*86400-900),
  ('demo000visit09', 'point003', 'demotoken0009', 'completed', unixepoch()-2*86400-600,   unixepoch()-2*86400,  unixepoch()-2*86400+3600, unixepoch()-2*86400-600),
  ('demo000visit10', 'point002', 'demotoken0010', 'completed', unixepoch()-3*86400-2700,  unixepoch()-3*86400,  unixepoch()-3*86400+4500, unixepoch()-3*86400-2700),
  -- 当前在店 1 人（在店人数演示）
  ('demo000visit11', 'point001', 'demotoken0011', 'in_store',   unixepoch()-1200,        unixepoch()-600,     NULL,                  unixepoch()-1200);

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
