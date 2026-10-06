import type { AdminUser } from '@/lib/types';
import { genId, unixNow } from './helpers';

// ---------------------------------------------------------------------------
// Admin Users
// ---------------------------------------------------------------------------

export async function getAdminByUsername(db: D1Database, username: string) {
  return db.prepare('SELECT * FROM admin_users WHERE username = ?')
    .bind(username).first<AdminUser & { password_hash: string }>();
}

export async function updateLastLogin(db: D1Database, id: string) {
  await db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?')
    .bind(unixNow(), id).run();
}

export async function listAdmins(db: D1Database) {
  const rows = await db.prepare(
    'SELECT id, username, role, display_name, created_at, last_login_at FROM admin_users ORDER BY created_at',
  ).all<AdminUser>();
  return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// Admin Users 管理（仅 super_admin 可用，权限在 API 层校验）
// ---------------------------------------------------------------------------

export async function createAdmin(
  db: D1Database,
  data: { username: string; password_hash: string; role: string; display_name: string },
) {
  const id = genId();
  await db.prepare(
    `INSERT INTO admin_users (id, username, password_hash, role, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, data.username, data.password_hash, data.role, data.display_name, unixNow(), unixNow()).run();
  return id;
}

export async function updateAdmin(
  db: D1Database,
  id: string,
  data: { password_hash?: string; role?: string; display_name?: string },
) {
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [unixNow()];
  for (const col of ['password_hash', 'role', 'display_name'] as const) {
    if (data[col] !== undefined) { sets.push(`${col} = ?`); bindings.push(data[col]); }
  }
  bindings.push(id);
  const r = await db.prepare(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
  return { changes: r.meta.changes ?? 0 };
}

export async function deleteAdmin(db: D1Database, id: string) {
  const r = await db.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  return { changes: r.meta.changes ?? 0 };
}
