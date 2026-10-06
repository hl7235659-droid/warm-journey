import type { ServicePoint } from '@/lib/types';

// DB 层内部工具。刻意不经 index.ts re-export：paginate / genId / parseJson* 不是公共接口。

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function unixNow() { return Math.floor(Date.now() / 1000); }

export function genId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// 查询码：10 位 Crockford base32（小写、去除 i/l/o/u 防误读），熵 ≈ 50 bit
// 10 位 Crockford base32 ≈ 50 bit 随机码：上报查询码与一次性入店码共用。
// 入店码校验用 `!==` 直接比：50 bit 熵 + 2 小时生命周期 + 每 IP 每分钟 10 次限流
// 已经把时序试探的空间压到没有，而原实现开头 `a.length !== b.length` 早退
// 本就先把长度泄漏出去，"恒定时间"名不副实。
export function genRandomCode() {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % 32]).join('');
}

export type RawPoint = ServicePoint & { services: string; admission: string };

// 分页查询的公共骨架：过滤拼 WHERE → 同一份 WHERE 计数 → LIMIT/OFFSET 取页。
// select/from 与 countFrom 分开写：列表要 JOIN 出人类可读的名称列，计数只认主表
// （一对多 JOIN 会让 COUNT 虚高）。所有 SQL 片段都是代码字面量，值一律走 bind。
interface PageQuery {
  select: string;
  from: string;
  countFrom: string;
  wheres?: string[];
  bindings?: unknown[];
  order: string;
  page: number;
  page_size: number;
}

export async function paginate<Row>(db: D1Database, q: PageQuery) {
  const where = q.wheres?.length ? `WHERE ${q.wheres.join(' AND ')}` : '';
  const bindings = q.bindings ?? [];
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${q.select} ${q.from} ${where} ${q.order} LIMIT ? OFFSET ?`)
      .bind(...bindings, q.page_size, (q.page - 1) * q.page_size).all<Row>(),
    db.prepare(`SELECT COUNT(*) as n ${q.countFrom} ${where}`).bind(...bindings).first<{ n: number }>(),
  ]);
  return { rows: rows.results ?? [], total: count?.n ?? 0 };
}

// 坏数据（非法 JSON）不应把整条读路径打成 500：解析失败降级为空值并留痕
export function parseJsonArray<T = string>(raw: string | null | undefined, ctx: string): T[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    console.error(`malformed JSON array in ${ctx}`);
    return [];
  }
}

export function parseJsonObject<T>(raw: string | null | undefined, ctx: string): T {
  try {
    const v = JSON.parse(raw ?? '{}');
    return v && typeof v === 'object' ? (v as T) : ({} as T);
  } catch {
    console.error(`malformed JSON object in ${ctx}`);
    return {} as T;
  }
}

export function deserializePoint(r: RawPoint): ServicePoint {
  // 显式挑字段而不是 `...r`：点位行里留着 created_by 这类管理员侧列，
  // 原样展开等于每页公开列表都下发一次管理员用户 id（P3-29）。
  // 从此新增列默认不下发，要下发必须在这里登记一次。
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    city: r.city,
    district: r.district,
    contact_phone: r.contact_phone,
    open_hours: r.open_hours,
    status: r.status,
    notes: r.notes,
    verified_at: r.verified_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    services: parseJsonArray(r.services, 'service_points.services'),
    admission: parseJsonObject<ServicePoint['admission']>(r.admission, 'service_points.admission'),
  };
}

// 北京时间（UTC+8）当日 0 点的 unix 秒
export function shanghaiDayStart(now = unixNow()): number {
  return Math.floor((now + 8 * 3600) / 86400) * 86400 - 8 * 3600;
}

// haversine（米）——与首页前端同口径
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
