-- 暖途同行 数据库 Schema
-- Cloudflare D1 (SQLite)

-- 管理员用户
CREATE TABLE IF NOT EXISTS admin_users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  username    TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'inspector' CHECK(role IN ('super_admin','admin','inspector')),
  display_name TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);

-- 服务点主表
CREATE TABLE IF NOT EXISTS service_points (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name         TEXT NOT NULL,
  address      TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  city         TEXT NOT NULL DEFAULT '',
  district     TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  open_hours   TEXT NOT NULL DEFAULT '全天',
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK(status IN ('open','closed','temp_closed')),
  services     TEXT NOT NULL DEFAULT '[]',   -- JSON array of service tags
  admission    TEXT NOT NULL DEFAULT '{}',   -- JSON: requirements, capacity, etc.
  notes        TEXT NOT NULL DEFAULT '',
  verified_at  INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by   TEXT REFERENCES admin_users(id)
);

-- 点位变更历史（每次 UPDATE 后插入）
CREATE TABLE IF NOT EXISTS point_history (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  point_id      TEXT NOT NULL REFERENCES service_points(id) ON DELETE CASCADE,
  changed_by    TEXT REFERENCES admin_users(id),
  changed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  snapshot      TEXT NOT NULL DEFAULT '{}'  -- full JSON snapshot of the row
);

-- 匿名上报
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  point_id    TEXT NOT NULL REFERENCES service_points(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'other'
               CHECK(category IN ('closed','info_wrong','facility','safety','other')),
  content     TEXT NOT NULL,
  images      TEXT NOT NULL DEFAULT '[]',  -- JSON array of R2 keys
  status      TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','processing','resolved','closed')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  work_order_id TEXT REFERENCES work_orders(id),
  query_code  TEXT                          -- 免登录查询码（高熵，独立于 id）
);

-- 工单
CREATE TABLE IF NOT EXISTS work_orders (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  point_id    TEXT REFERENCES service_points(id) ON DELETE SET NULL,
  report_id   TEXT REFERENCES reports(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'open'
               CHECK(status IN ('open','in_progress','resolved','closed')),
  priority    TEXT NOT NULL DEFAULT 'normal'
               CHECK(priority IN ('low','normal','high','urgent')),
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by  TEXT REFERENCES admin_users(id)
);
-- 同一上报只允许关联一个工单（并发自动建单 / 手动重复建单兜底）
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_report
  ON work_orders(report_id) WHERE report_id IS NOT NULL;

-- 巡检记录
CREATE TABLE IF NOT EXISTS inspections (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  point_id       TEXT NOT NULL REFERENCES service_points(id) ON DELETE CASCADE,
  inspector_id   TEXT REFERENCES admin_users(id),
  result         TEXT NOT NULL DEFAULT 'pass'
                  CHECK(result IN ('pass','fail','partial')),
  findings       TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  images         TEXT NOT NULL DEFAULT '[]',
  notes          TEXT NOT NULL DEFAULT '',
  inspected_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 骑手「信息无误」一键确认
CREATE TABLE IF NOT EXISTS point_confirms (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  point_id    TEXT NOT NULL REFERENCES service_points(id) ON DELETE CASCADE,
  rider_token TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_confirms_token ON point_confirms(point_id, rider_token, created_at);

-- 开通城市（多城市扩展：首页筛选 + 地图默认视野）
CREATE TABLE IF NOT EXISTS cities (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name        TEXT NOT NULL UNIQUE,
  center_lat  REAL NOT NULL DEFAULT 0,
  center_lng  REAL NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 预约 / 入店记录（骑手免登录，rider_token 为浏览器匿名标识）
CREATE TABLE IF NOT EXISTS visits (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  point_id      TEXT NOT NULL REFERENCES service_points(id) ON DELETE CASCADE,
  rider_token   TEXT NOT NULL,
  created_ip    TEXT,
  checkin_code  TEXT,                     -- 一次性入店码：二维码携带，防仅凭 visit id 远程确认
  status        TEXT NOT NULL DEFAULT 'reserved'
                  CHECK(status IN ('reserved','in_store','completed','cancelled','expired')),
  reserved_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  checked_in_at INTEGER,
  checked_out_at INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
-- 同一点位同一骑手至多一条进行中记录（并发重复预约兜底）
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_active_rider
  ON visits(point_id, rider_token) WHERE status IN ('reserved','in_store');
CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(created_ip, status) WHERE created_ip IS NOT NULL;

-- 离店满意度反馈（一次 visit 一条）
CREATE TABLE IF NOT EXISTS visit_feedback (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  visit_id    TEXT NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
  point_id    TEXT NOT NULL REFERENCES service_points(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  supports    TEXT NOT NULL DEFAULT '[]',   -- JSON array：希望获得的支持
  suggestion  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_points_status  ON service_points(status);
CREATE INDEX IF NOT EXISTS idx_points_city    ON service_points(city);
CREATE INDEX IF NOT EXISTS idx_history_point  ON point_history(point_id);
CREATE INDEX IF NOT EXISTS idx_reports_point  ON reports(point_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_query_code ON reports(query_code) WHERE query_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status  ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_point   ON work_orders(point_id);
CREATE INDEX IF NOT EXISTS idx_inspections_point ON inspections(point_id);
-- idx_confirms_point(point_id) 不建：它是上面 idx_confirms_token(point_id, rider_token,
-- created_at) 的最左前缀，留着只让每次确认多维护一棵树（存量库由批次 7 迁移删除）
CREATE INDEX IF NOT EXISTS idx_visits_point_status ON visits(point_id, status);
CREATE INDEX IF NOT EXISTS idx_visits_status   ON visits(status);
CREATE INDEX IF NOT EXISTS idx_visits_rider    ON visits(rider_token, status);
CREATE INDEX IF NOT EXISTS idx_feedback_point  ON visit_feedback(point_id);

-- 上传台账：upload 签发的 key 与上传者 IP 记账，上报引用时校验归属
CREATE TABLE IF NOT EXISTS uploads (
  key        TEXT PRIMARY KEY,
  ip         TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_uploads_ip ON uploads(ip, created_at);

-- AI 助手业务知识库（管理端维护，小暖检索注入 prompt）
CREATE TABLE IF NOT EXISTS ai_knowledge (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  category   TEXT NOT NULL CHECK(category IN ('rights','channel','faq','notice')),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',  -- JSON array，检索用
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_cat ON ai_knowledge(category, enabled);

-- AI 接口频率限制（每 IP 每分钟窗口计数）
CREATE TABLE IF NOT EXISTS ai_rate (
  ip           TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
