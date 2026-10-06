import type { KnowledgeCategory } from '@/lib/types';
import { likeTerm } from '@/lib/like-term';
import { genId, paginate, unixNow } from './helpers';

// ---------------------------------------------------------------------------
// AI 助手（知识库 / 动态上下文 / 口碑聚合 / 限流）
// ---------------------------------------------------------------------------

export type AiKnowledgeCategory = KnowledgeCategory;

export interface AiKnowledge {
  id: string;
  category: AiKnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  enabled: boolean;
  updated_at: number;
}

type RawKnowledge = Omit<AiKnowledge, 'tags' | 'enabled'> & { tags: string; enabled: number };

function deserializeKnowledge(r: RawKnowledge): AiKnowledge {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags) as string[]; } catch { /* 坏数据容忍 */ }
  return { ...r, tags, enabled: r.enabled === 1 };
}

export async function listKnowledge(
  db: D1Database,
  opts: { category?: string; enabled?: boolean; q?: string; page?: number; page_size?: number } = {},
) {
  const { category, enabled, q, page = 1, page_size = 20 } = opts;
  const wheres: string[] = [];
  const bindings: unknown[] = [];
  if (category) { wheres.push('category = ?'); bindings.push(category); }
  if (enabled !== undefined) { wheres.push('enabled = ?'); bindings.push(enabled ? 1 : 0); }
  if (q) {
    const qq = likeTerm(q);
    if (qq) {
      wheres.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)');
      bindings.push(`%${qq}%`, `%${qq}%`, `%${qq}%`);
    }
  }
  const { rows, total } = await paginate<RawKnowledge>(db, {
    select: '*', from: 'FROM ai_knowledge', countFrom: 'FROM ai_knowledge',
    wheres, bindings, order: 'ORDER BY updated_at DESC', page, page_size,
  });
  return { items: rows.map(deserializeKnowledge), total, page, page_size };
}

export async function createKnowledge(
  db: D1Database,
  data: { category: string; title: string; content: string; tags: string[] },
) {
  const id = genId();
  await db.prepare(
    `INSERT INTO ai_knowledge (id, category, title, content, tags, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).bind(id, data.category, data.title, data.content, JSON.stringify(data.tags), unixNow()).run();
  return id;
}

export async function updateKnowledge(
  db: D1Database,
  id: string,
  data: { category?: string; title?: string; content?: string; tags?: string[]; enabled?: boolean },
) {
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [unixNow()];
  if (data.category !== undefined) { sets.push('category = ?'); bindings.push(data.category); }
  if (data.title !== undefined) { sets.push('title = ?'); bindings.push(data.title); }
  if (data.content !== undefined) { sets.push('content = ?'); bindings.push(data.content); }
  if (data.tags !== undefined) { sets.push('tags = ?'); bindings.push(JSON.stringify(data.tags)); }
  if (data.enabled !== undefined) { sets.push('enabled = ?'); bindings.push(data.enabled ? 1 : 0); }
  bindings.push(id);
  const r = await db.prepare(`UPDATE ai_knowledge SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
  return { changes: r.meta.changes ?? 0 };
}

export async function deleteKnowledge(db: D1Database, id: string) {
  const r = await db.prepare('DELETE FROM ai_knowledge WHERE id = ?').bind(id).run();
  return { changes: r.meta.changes ?? 0 };
}

// 知识检索（注入 prompt 用）：tags/标题/正文命中计分，取 topN
export async function searchKnowledge(
  db: D1Database,
  query: string,
  opts: { topN?: number } = {},
) {
  const { topN = 3 } = opts;
  const rows = await db.prepare(
    'SELECT * FROM ai_knowledge WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 50',
  ).all<RawKnowledge>();
  const q = (query || '').trim().toLowerCase();
  const items = (rows.results ?? []).map(deserializeKnowledge);
  if (!q) return items.slice(0, topN);
  const scored = items
    .map((k) => {
      let score = 0;
      for (const t of k.tags) if (q.includes(t.toLowerCase())) score += 2;
      if (k.title.toLowerCase().includes(q)) score += 1;
      for (const seg of q.split(/[\s，。？！、]+/)) {
        if (seg.length >= 2 && k.content.toLowerCase().includes(seg)) score += 1;
      }
      return { k, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.k);
}
