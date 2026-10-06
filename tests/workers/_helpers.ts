// 批次 4 用例的公共地基：建库、种最小数据、把 OpenNext 的 Cloudflare 上下文接到测试 Worker 上。
// 说明：用例跑在真实 workerd + 真实 D1（SQLite）里，每个测试文件一份独立存储
// （vitest-pool-workers 的 isolatedStorage 默认 true），所以 applySchema 在各文件 beforeAll 各跑一次。
import { env } from 'cloudflare:test';
import { SignJWT } from 'jose';

import schemaSql from '../../src/lib/db/schema.sql?raw';
import { signToken, type AdminPayload } from '@/lib/auth';

export { env };

// 与 @opennextjs/cloudflare 内部用的 Symbol 同键（dist/api/cloudflare-context.js）。
// withAdmin 和各 visit 路由都靠 getCloudflareContext() 取 env，这里把它接到测试 Worker 的 env 上，
// 被测代码一行不改、也不 mock。
const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__');

export function installCloudflareContext(): void {
  const globalScope = globalThis as Record<symbol, unknown>;
  globalScope[CLOUDFLARE_CONTEXT] = {
    env,
    ctx: { waitUntil: () => {}, passThroughOnException: () => {} },
    caches: globalThis.caches,
  };
}

// schema.sql 无触发器/无 BEGIN 块，按语句切分即可；先剥掉 `--` 注释行，
// 否则 D1 会把"只有注释"的片段判成空语句报错。
export async function applySchema(): Promise<void> {
  const statements = schemaSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sql) => env.DB.prepare(sql));
  await env.DB.batch(statements);
}

export const RIDER_A = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a10001';
export const RIDER_B = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b20002';
export const RIDER_C = 'c3c3c3c3c3c3c3c3c3c3c3c3c3c30003';

export interface SeedPointOptions {
  id?: string;
  status?: 'open' | 'closed' | 'temp_closed';
  capacity?: number | null;
}

// 最小点位：只给必填列，capacity 走 admission JSON（reserveVisit 的容量闸门读它）
export async function seedPoint(opts: SeedPointOptions = {}): Promise<string> {
  const id = opts.id ?? 'point0000seed01';
  const admission = opts.capacity == null ? '{}' : JSON.stringify({ capacity: opts.capacity });
  await env.DB.prepare(
    `INSERT INTO service_points (id, name, address, lat, lng, status, services, admission)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?)`,
  )
    .bind(id, '测试驿站', '测试地址', 23.1291, 113.3309, opts.status ?? 'open', admission)
    .run();
  return id;
}

export type SeedAdminOptions = Partial<AdminPayload> & { id?: string };

// 直接写库而不走 createAdmin：这里要的是"库里就是这么一行"，哈希与业务校验不是本批次被测面
export async function seedAdmin(opts: SeedAdminOptions = {}): Promise<AdminPayload> {
  const payload: AdminPayload = {
    sub: opts.sub ?? 'admin0000seed01',
    username: opts.username ?? 'seed_admin',
    role: opts.role ?? 'super_admin',
    display_name: opts.display_name ?? '种子的管理员',
  };
  await env.DB.prepare(
    `INSERT INTO admin_users (id, username, password_hash, role, display_name)
     VALUES (?, ?, 'not-a-real-hash', ?, ?)`,
  )
    .bind(payload.sub, payload.username, payload.role, payload.display_name)
    .run();
  return payload;
}

export async function deleteAdmin(id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
}

export async function changeAdminRole(id: string, role: string): Promise<void> {
  await env.DB.prepare('UPDATE admin_users SET role = ? WHERE id = ?').bind(role, id).run();
}

// 生产签发路径（8h 有效期），token 走 Cookie 或 Bearer 都可
export function adminToken(payload: AdminPayload): Promise<string> {
  return signToken(payload, env);
}

// 手工签发：绕开 auth.ts 的 EXPIRY 常量，用于造"过期 token"与"换密钥的 token"
export async function rawToken(
  payload: AdminPayload,
  opts: { secret?: string; expiresInSec?: number } = {},
): Promise<string> {
  const secret = opts.secret ?? env.JWT_SECRET ?? 'wrong-secret';
  const key = new TextEncoder().encode(secret);
  const jwt = new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + (opts.expiresInSec ?? 3600));
  return jwt.sign(key);
}

export function authHeaders(token: string): HeadersInit {
  return { cookie: `__Host-wj_admin=${token}` };
}

export async function setVisitState(
  id: string,
  fields: Record<string, number | string | null>,
): Promise<void> {
  const columns = Object.keys(fields);
  await env.DB.prepare(
    `UPDATE visits SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
  )
    .bind(...columns.map((c) => fields[c]), id)
    .run();
}

export interface SeedVisitOptions {
  id: string;
  // 缺省 'reserved'（与 visits.status 的列默认值一致）
  status?: 'reserved' | 'in_store' | 'completed' | 'cancelled' | 'expired';
  // 必填：visits.point_id 有外键，种子点位必须由调用方先 seedPoint
  pointId: string;
  rider?: string;
  code?: string | null;
  reservedAt?: number;
  checkedInAt?: number | null;
  checkedOutAt?: number | null;
  ip?: string | null;
}

// 迁移表用例要的是"库里就是这么一行"，所以直接 INSERT 而不走 reserveVisit。
// checkin_code 默认给一个合法形态（10 位小写字母数字），置 NULL 表示"码已被消费"。
// rider 缺省按 id 派生：库里有一条部分唯一索引 idx_visits_active_rider
// (point_id, rider_token) WHERE status IN ('reserved','in_store')，
// 同一点位多个"进行中"种子行必须各用自己的 token，否则第二条起就撞索引。
function riderFromId(id: string): string {
  let hex = '';
  for (const ch of id) hex += (ch.charCodeAt(0) % 16).toString(16);
  return hex.padEnd(16, '0').slice(0, 16);
}

export async function seedVisit(opts: SeedVisitOptions): Promise<string> {
  const now = nowUnix();
  const status = opts.status ?? 'reserved';
  const active = status === 'in_store' || status === 'completed';
  await env.DB.prepare(
    `INSERT INTO visits (id, point_id, rider_token, created_ip, checkin_code, status,
                         reserved_at, checked_in_at, checked_out_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      opts.id,
      opts.pointId,
      opts.rider ?? riderFromId(opts.id),
      opts.ip ?? null,
      opts.code === undefined ? 'abcd1234ef' : opts.code,
      status,
      opts.reservedAt ?? now,
      opts.checkedInAt !== undefined ? opts.checkedInAt : (active ? now - 600 : null),
      opts.checkedOutAt !== undefined ? opts.checkedOutAt : (status === 'completed' ? now - 60 : null),
      now,
    )
    .run();
  return opts.id;
}

export async function readVisit(id: string) {
  return env.DB.prepare('SELECT * FROM visits WHERE id = ?').bind(id).first<Record<string, unknown>>();
}

// 种子行缺省 rider 由 id 派生；需要"以本人身份"调用接口/DB 函数时用这个取回那 16 位 hex
export async function riderOf(visitId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT rider_token FROM visits WHERE id = ?')
    .bind(visitId).first<{ rider_token: string }>();
  if (!row) throw new Error(`种子行不存在：${visitId}`);
  return row.rider_token;
}

export async function countVisits(pointId: string, statuses: string[]): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM visits WHERE point_id = ? AND status IN (${statuses.map(() => '?').join(',')})`,
  ).bind(pointId, ...statuses).first<{ n: number }>();
  return row?.n ?? 0;
}

export const nowUnix = () => Math.floor(Date.now() / 1000);
