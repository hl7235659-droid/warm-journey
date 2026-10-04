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
  '{"platform_required":"美团","id_required":true,"capacity":20,"notes":"需出示美团骑手码"}',
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
  '{"platform_required":"顺丰","id_required":true,"capacity":15}',
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
  '{"platform_required":null,"id_required":false,"capacity":30,"notes":"所有平台骑手均可使用"}',
  '免费提供午餐（11:00–13:00），需凭骑手工牌；环湖绿道可短时停车',
  'seed0000admin1'
);
