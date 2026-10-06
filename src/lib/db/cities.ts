import { genId, unixNow } from './helpers';

// ---------------------------------------------------------------------------
// Cities（多城市）
// ---------------------------------------------------------------------------

export interface City {
  id: string; name: string; center_lat: number; center_lng: number;
  enabled: number; created_at: number;
}

// 公网城市筛选器只要 id + name（首页 chip）；center_lat/lng 与 enabled 属管理端字段，
// 走 /api/admin/cities 的 listCities，不从公开接口整行下发。
export async function listEnabledCities(db: D1Database) {
  const rows = await db.prepare(
    'SELECT id, name FROM cities WHERE enabled = 1 ORDER BY created_at',
  ).all<Pick<City, 'id' | 'name'>>();
  return rows.results ?? [];
}

export async function listCities(db: D1Database) {
  const rows = await db.prepare('SELECT * FROM cities ORDER BY created_at').all<City>();
  return rows.results ?? [];
}

export async function createCity(
  db: D1Database,
  data: { name: string; center_lat: number; center_lng: number },
) {
  const id = genId();
  await db.prepare(
    'INSERT INTO cities (id, name, center_lat, center_lng, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  ).bind(id, data.name, data.center_lat, data.center_lng, unixNow()).run();
  return id;
}

export async function updateCity(
  db: D1Database,
  id: string,
  data: { name?: string; center_lat?: number; center_lng?: number; enabled?: number },
) {
  const sets: string[] = [];
  const bindings: unknown[] = [];
  for (const col of ['name', 'center_lat', 'center_lng', 'enabled'] as const) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  if (!sets.length) return { changes: 0 };
  bindings.push(id);
  const r = await db.prepare(`UPDATE cities SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
  return { changes: r.meta.changes ?? 0 };
}
