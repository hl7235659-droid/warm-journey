-- 初始管理员账户 (密码: admin123，生产环境请立即更换)
-- bcrypt hash of 'admin123' with salt rounds 10
INSERT OR IGNORE INTO admin_users (id, username, password_hash, role, display_name)
VALUES (
  'seed0000admin1',
  'admin',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.',
  'super_admin',
  '系统管理员'
);

-- 示例服务点
INSERT OR IGNORE INTO service_points
  (id, name, address, lat, lng, city, district, contact_phone,
   open_hours, status, services, admission, notes, created_by)
VALUES
(
  'point001',
  '美团骑手服务站（朝阳路）',
  '北京市朝阳区朝阳路88号底商101',
  39.9219, 116.4831,
  '北京', '朝阳区',
  '010-12345678',
  '周一至周日 07:00–22:00',
  'open',
  '["休息区","充电","饮用水","急救箱","厕所"]',
  '{"platform_required":"美团","id_required":true,"capacity":20,"notes":"需出示美团骑手码"}',
  '二楼设有微波炉，雨天可免费借用雨衣',
  'seed0000admin1'
),
(
  'point002',
  '顺丰速运骑士驿站（望京）',
  '北京市朝阳区望京街道阜通西大街6号院',
  40.0010, 116.4830,
  '北京', '朝阳区',
  '010-87654321',
  '全天24小时',
  'open',
  '["休息区","充电","饮用水","Wi-Fi","停车"]',
  '{"platform_required":"顺丰","id_required":true,"capacity":15}',
  '配有热水、茶叶，停车场免费1小时',
  'seed0000admin1'
),
(
  'point003',
  '骑手联合服务中心（中关村）',
  '北京市海淀区中关村大街38号',
  39.9827, 116.3179,
  '北京', '海淀区',
  '010-11223344',
  '周一至周五 08:00–20:00，周末 09:00–18:00',
  'open',
  '["休息区","充电","饮用水","急救箱","雨具","餐饮","Wi-Fi"]',
  '{"platform_required":null,"id_required":false,"capacity":30,"notes":"所有平台骑手均可使用"}',
  '免费提供午餐（11:00–13:00），需凭骑手工牌',
  'seed0000admin1'
);
