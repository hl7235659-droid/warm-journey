'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCanWrite } from '../admin-context';
import type { AiKnowledge } from '@/lib/db';
import { api, ACTION_ERR } from '@/lib/api-client';
import { KNOWLEDGE_CATEGORIES } from '@/lib/types';
import type { KnowledgeCategory } from '@/lib/types';

const CATEGORIES: Record<KnowledgeCategory, string> = {
  rights: '权益政策', channel: '求助渠道', faq: '常见问题', notice: '平台公告',
};
type CategoryKey = KnowledgeCategory;
const CATEGORY_KEYS: readonly CategoryKey[] = KNOWLEDGE_CATEGORIES;
const CATEGORY_BADGE: Record<CategoryKey, string> = {
  rights: 'badge-blue', channel: 'badge-green', faq: 'badge-amber', notice: 'badge-gray',
};

/** 逗号分隔 → 去空去重、单项 ≤20 字、最多 10 个 */
function parseTags(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(/[,，]/)) {
    const t = raw.trim().slice(0, 20);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

export default function AdminKnowledgePage() {
  const canWrite = useCanWrite();
  const [items, setItems] = useState<AiKnowledge[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<CategoryKey | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AiKnowledge | null>(null);
  const [form, setForm] = useState({ category: 'faq' as CategoryKey, title: '', content: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: '1', page_size: '50' });
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    const j = await api<{ items: AiKnowledge[]; total: number }>(`/api/admin/knowledge?${p}`);
    if (j.ok && j.data) { setItems(j.data.items); setTotal(j.data.total); }
    setLoading(false);
  }, [category, q]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setError('');
    setForm({ category: category || 'faq', title: '', content: '', tags: '' });
    setShowForm(true);
  }

  function openEdit(it: AiKnowledge) {
    setEditing(it);
    setError('');
    setForm({ category: it.category, title: it.title, content: it.content, tags: it.tags.join(', ') });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('标题不能为空'); return; }
    if (!form.content.trim()) { setError('正文不能为空'); return; }
    setSaving(true);
    setError('');
    const j = await api(editing ? `/api/admin/knowledge/${editing.id}` : '/api/admin/knowledge', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: form.category,
        title: form.title.trim(),
        content: form.content.trim(),
        tags: parseTags(form.tags),
      }),
    });
    setSaving(false);
    if (j.ok) { closeForm(); void load(); }
    else { const msg = j.error ?? '保存失败'; setError(msg); alert(msg); }
  }

  async function toggleEnabled(it: AiKnowledge) {
    const j = await api(`/api/admin/knowledge/${it.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !it.enabled }),
    });
    if (j.ok) void load();
    else alert(j.error ?? ACTION_ERR);
  }

  async function remove(it: AiKnowledge) {
    if (!window.confirm(`确定删除「${it.title}」？此操作不可恢复。`)) return;
    const j = await api(`/api/admin/knowledge/${it.id}`, { method: 'DELETE' });
    if (j.ok) void load();
    else alert(j.error ?? '删除失败');
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>AI 知识库</h1>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ 新增条目</button>}
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        维护 AI 助手小暖的业务知识条目（权益政策 / 求助渠道 / 常见问题 / 平台公告），启用条目会被检索引用并附出处。
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.625rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          <button className={`btn btn-sm ${category === '' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory('')}>全部</button>
          {CATEGORY_KEYS.map(k => (
            <button key={k} className={`btn btn-sm ${category === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory(k)}>
              {CATEGORIES[k]}
            </button>
          ))}
        </div>
        <form
          onSubmit={e => { e.preventDefault(); setQ(searchInput.trim()); }}
          style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}
        >
          <input
            className="input"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索标题 / 正文 / 标签"
            style={{ width: '220px' }}
          />
          <button type="submit" className="btn btn-secondary btn-sm">搜索</button>
          {q && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearchInput(''); setQ(''); }}>清除</button>
          )}
        </form>
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['类别', '标题', '标签', '状态', '更新时间', '操作'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [1,2,3].map(i => (
              <tr key={i}>{[1,2,3,4,5,6].map(j => (
                <td key={j} style={{ padding: '0.75rem' }}><div className="skeleton" style={{ height: '16px', borderRadius: '4px' }} /></td>
              ))}</tr>
            )) : items.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                {q ? '没有匹配的条目' : '暂无知识条目，点击右上角新增'}
              </td></tr>
            ) : items.map(it => (
              <tr key={it.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                  <span className={`badge ${CATEGORY_BADGE[it.category] ?? 'badge-gray'}`}>{CATEGORIES[it.category] ?? it.category}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', maxWidth: '360px' }}>
                  <div style={{ fontWeight: 500 }}>{it.title}</div>
                  <div style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.content}
                  </div>
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  {it.tags.length === 0 ? (
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
                      {it.tags.slice(0, 5).map(t => <span key={t} className="tag">{t}</span>)}
                      {it.tags.length > 5 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>+{it.tags.length - 5}</span>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${it.enabled ? 'badge-green' : 'badge-gray'}`}>{it.enabled ? '启用' : '停用'}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  {fmtDate(it.updated_at)}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
          {canWrite && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => openEdit(it)}>编辑</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleEnabled(it)}>{it.enabled ? '停用' : '启用'}</button>
              <button className="btn btn-danger btn-sm" onClick={() => remove(it)}>删除</button>
            </>
          )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.75rem' }}>
        共 {total} 条{category ? `（${CATEGORIES[category]}）` : ''}{q ? `，关键词「${q}」` : ''}
      </p>

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>{editing ? '编辑知识条目' : '新增知识条目'}</h2>
            <form onSubmit={submit} noValidate>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="k-category">类别 *</label>
                <select
                  id="k-category"
                  className="select"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as CategoryKey }))}
                >
                  {CATEGORY_KEYS.map(k => <option key={k} value={k}>{CATEGORIES[k]}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="k-title">标题 *（≤60 字）</label>
                <input
                  id="k-title"
                  className="input"
                  value={form.title}
                  maxLength={60}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="例：骑手高温补贴申请条件"
                  required
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="k-content">正文 *（≤2000 字）</label>
                <textarea
                  id="k-content"
                  className="textarea"
                  value={form.content}
                  maxLength={2000}
                  rows={8}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="写清适用对象、条件、流程与注意事项，便于 AI 检索后准确引用。"
                  required
                />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="k-tags">标签（逗号分隔，最多 10 个，单个 ≤20 字）</label>
                <input
                  id="k-tags"
                  className="input"
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="例：高温补贴, 权益政策"
                />
              </div>
              {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>⚠ {error}</p>}
              <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={closeForm}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '保存中…' : editing ? '保存' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
