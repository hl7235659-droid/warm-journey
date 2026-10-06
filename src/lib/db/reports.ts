import type { Report, ReportCategory, ReportStatus } from '@/lib/types';
import { genId, genRandomCode, paginate, parseJsonArray, unixNow } from './helpers';

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function createReport(
  db: D1Database,
  data: { point_id: string; category: string; content: string; images: string[] },
) {
  // 显式生成 id（与表默认值同格式：16 位小写 hex），D1 run() 的 last_row_id 拿不到 TEXT 主键。
  const id = genId();
  // 查询码为独立高熵字段（10 位 Crockford base32 ≈ 50 bit），
  // 不再暴露 report id 前缀，防止批量枚举他人上报。
  // 唯一索引撞码（概率极低）时重生成重试一次，而不是把 500 甩给用户。
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = genRandomCode();
    try {
      await db.prepare(
        `INSERT INTO reports (id, point_id, category, content, images, query_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, data.point_id, data.category, data.content, JSON.stringify(data.images), code, unixNow()).run();
      return { id, query_code: code };
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? '';
      if (msg.includes('UNIQUE') && msg.includes('query_code')) { lastErr = e; continue; }
      throw e;
    }
  }
  throw new Error(`查询码生成连续冲突：${(lastErr as { message?: string })?.message ?? 'unknown'}`);
}

// 免登录进度查询：凭查询码精确匹配。只返回进度必需字段，content 不对公网暴露。
// 旧版"report id 前 10 位"兼容分支已删：生产 reports 表 0 行、无存量旧码用户，
// 而唯一会写出旧码的入口（migrate-20261005 的回填）也已随批次 7 的迁移链退场。
export async function getReportByCode(db: D1Database, code: string) {
  const normalized = code.trim().toLowerCase();
  if (!/^[0-9a-z]{10}$/.test(normalized)) return null;
  return db.prepare(
    `SELECT r.id, r.point_id, r.category, r.status, r.created_at, sp.name as point_name
     FROM reports r LEFT JOIN service_points sp ON sp.id = r.point_id
     WHERE r.query_code = ? LIMIT 1`,
  ).bind(normalized).first<ReportStatusPublic>();
}

// category/status 由 schema.sql 的 CHECK 约束保证落在领域枚举内
export interface ReportStatusPublic {
  id: string; point_id: string; category: ReportCategory;
  status: ReportStatus; created_at: number; point_name?: string;
}

export async function listReports(
  db: D1Database,
  opts: { status?: string; page?: number; page_size?: number } = {},
) {
  const { status, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (status) { wheres.push('r.status = ?'); bindings.push(status); }
  const { rows, total } = await paginate<Report & { images: string; point_name?: string }>(db, {
    select: 'r.*, sp.name as point_name',
    from: 'FROM reports r LEFT JOIN service_points sp ON sp.id = r.point_id',
    countFrom: 'FROM reports r',
    wheres, bindings, order: 'ORDER BY r.created_at DESC', page, page_size,
  });
  return {
    items: rows.map(r => ({ ...r, images: parseJsonArray(r.images, 'reports.images') })),
    total, page, page_size,
  };
}

export async function updateReport(db: D1Database, id: string, data: Partial<Report>) {
  const sets: string[] = [];
  const bindings: unknown[] = [];
  if (data.status) { sets.push('status = ?'); bindings.push(data.status); }
  if (data.work_order_id !== undefined) { sets.push('work_order_id = ?'); bindings.push(data.work_order_id); }
  if (!sets.length) return;
  bindings.push(id);
  await db.prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}
