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
  qr_code_url  TEXT NOT NULL DEFAULT '',
  verified_at  INTEGER,
  verified_by  TEXT REFERENCES admin_users(id),
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
  change_summary TEXT NOT NULL DEFAULT '',
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
  work_order_id TEXT REFERENCES work_orders(id)
);

-- 工单
CREATE TABLE IF NOT EXISTS work_orders (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  point_id    TEXT REFERENCES service_points(id) ON DELETE SET NULL,
  report_id   TEXT REFERENCES reports(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES admin_users(id),
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

CREATE INDEX IF NOT EXISTS idx_points_status  ON service_points(status);
CREATE INDEX IF NOT EXISTS idx_points_city    ON service_points(city);
CREATE INDEX IF NOT EXISTS idx_history_point  ON point_history(point_id);
CREATE INDEX IF NOT EXISTS idx_reports_point  ON reports(point_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_point   ON work_orders(point_id);
CREATE INDEX IF NOT EXISTS idx_inspections_point ON inspections(point_id);
