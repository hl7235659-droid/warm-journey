import type { Inspection } from '@/lib/types';
import { paginate, parseJsonArray, unixNow } from './helpers';

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

export async function createInspection(
  db: D1Database,
  data: Omit<Inspection, 'id' | 'created_at'>,
) {
  const now = unixNow();
  return db.prepare(
    `INSERT INTO inspections (point_id, inspector_id, result, images, notes, inspected_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).bind(
    data.point_id, data.inspector_id ?? null, data.result,
    JSON.stringify(data.images),
    data.notes, data.inspected_at ?? now, now,
  ).run();
}

export async function listInspections(
  db: D1Database,
  opts: { page?: number; page_size?: number } = {},
) {
  const { page = 1, page_size = 20 } = opts;
  const { rows, total } = await paginate<Inspection & { images: string }>(db, {
    select: 'i.*, sp.name as point_name, au.display_name as inspector_name',
    from: `FROM inspections i
           LEFT JOIN service_points sp ON sp.id = i.point_id
           LEFT JOIN admin_users au ON au.id = i.inspector_id`,
    countFrom: 'FROM inspections i',
    order: 'ORDER BY i.inspected_at DESC', page, page_size,
  });
  return {
    items: rows.map(r => ({ ...r, images: parseJsonArray(r.images, 'inspections.images') })),
    total, page, page_size,
  };
}
