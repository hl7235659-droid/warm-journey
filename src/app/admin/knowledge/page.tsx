'use client';

import { useCallback, useState } from 'react';
import { useCanWrite } from '../admin-context';
import { EmptyRow, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import { ModalForm, useAdminForm } from '@/components/admin/modal-form';
import type { AiKnowledge } from '@/lib/db';
import { api, ACTION_ERR } from '@/lib/api-client';
import { formatCNDate } from '@/lib/format';
import { KNOWLEDGE_CATEGORIES } from '@/lib/types';
import type { KnowledgeCategory } from '@/lib/types';

type CategoryKey = KnowledgeCategory;
const CATEGORY_LABELS: Record<CategoryKey, string> = {
  rights: '权益政策', channel: '求助渠道', faq: '常见问题', notice: '平台公告',
};
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

const BLANK = () => ({ category: 'faq' as CategoryKey, title: '', content: '', tags: '' });

export default function AdminKnowledgePage() {
  const canWrite = useCanWrite();
  const [category, setCategory] = useState<CategoryKey | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<AiKnowledge | null>(null);

  const fetchKnowledge = useCallback(async (page: number): Promise<ListResp<AiKnowledge>> => {
    const p = new URLSearchParams({ page: String(page), page_size: '50' });
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    const j = await api<{ items: AiKnowledge[]; total: number }>(`/api/admin/knowledge?${p}`);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data.items, total: j.data.total };
  }, [category, q]);

  const { items, total, page, loading, error, reload } = useAdminList(fetchKnowledge);

  const {
    showForm, saving, formError, setFormError, form, setForm, openForm, closeForm: closeBaseForm, submit,
  } = useAdminForm('/api/admin/knowledge', {
    blank: BLANK, onSaved: reload, failureMode: 'both', errorFallback: '保存失败',
  });

  function openCreate() {
    setEditing(null);
    openForm({ ...BLANK(), category: category || 'faq' });
  }

  function openEdit(it: AiKnowledge) {
    setEditing(it);
    openForm({ category: it.category, title: it.title, content: it.content, tags: it.tags.join(', ') });
  }

  function closeForm() {
    setEditing(null);
    closeBaseForm();
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setFormError('标题不能为空'); return; }
    if (!form.content.trim()) { setFormError('正文不能为空'); return; }
    const saved = await submit(
      {
        category: form.category,
        title: form.title.trim(),
        content: form.content.trim(),
        tags: parseTags(form.tags),
      },
      editing ? { url: `/api/admin/knowledge/${editing.id}`, method: 'PUT' } : undefined,
    );
    if (saved) setEditing(null);
  }

  async function toggleEnabled(it: AiKnowledge) {
    const j = await api(`/api/admin/knowledge/${it.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !it.enabled }),
    });
    if (j.ok) reload();
    else alert(j.error ?? ACTION_ERR);
  }

  async function remove(it: AiKnowledge) {
    if (!window.confirm(`确定删除「${it.title}」？此操作不可恢复。`)) return;
    const j = await api(`/api/admin/knowledge/${it.id}`, { method: 'DELETE' });
    if (j.ok) reload();
    else alert(j.error ?? '删除失败');
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">AI 知识库</h1>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ 新增条目</button>}
      </div>

      <p className="hint">
        维护 AI 助手小暖的业务知识条目（权益政策 / 求助渠道 / 常见问题 / 平台公告），启用条目会被检索引用并附出处。
      </p>

      <div className="field" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.625rem' }}>
        <div className="flow-row">
          <button className={`btn btn-sm ${category === '' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory('')}>全部</button>
          {KNOWLEDGE_CATEGORIES.map(k => (
            <button key={k} className={`btn btn-sm ${category === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCategory(k)}>
              {CATEGORY_LABELS[k]}
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

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['类别', '标题', '标签', '状态', '更新时间', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={6} /> : items.length === 0 ? (
              <EmptyRow cols={6} text={q ? '没有匹配的条目' : '暂无知识条目，点击右上角新增'} />
            ) : items.map(it => (
              <tr key={it.id}>
                <td className="td-nowrap">
                  <span className={`badge ${CATEGORY_BADGE[it.category] ?? 'badge-gray'}`}>{CATEGORY_LABELS[it.category] ?? it.category}</span>
                </td>
                <td style={{ maxWidth: '360px' }}>
                  <div style={{ fontWeight: 500 }}>{it.title}</div>
                  <div style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: '0.15rem' }} className="ellipsis">
                    {it.content}
                  </div>
                </td>
                <td>
                  {it.tags.length === 0 ? (
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
                      {it.tags.slice(0, 5).map(t => <span key={t} className="tag">{t}</span>)}
                      {it.tags.length > 5 && <span className="faint-xs">+{it.tags.length - 5}</span>}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`badge ${it.enabled ? 'badge-green' : 'badge-gray'}`}>{it.enabled ? '启用' : '停用'}</span>
                </td>
                <td className="td-time">{formatCNDate(it.updated_at)}</td>
                <td className="td-nowrap">
                  <div className="flow-row" style={{ gap: '0.25rem' }}>
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
        共 {total} 条{category ? `（${CATEGORY_LABELS[category]}）` : ''}{q ? `，关键词「${q}」` : ''}
      </p>

      {showForm && (
        <ModalForm
          title={editing ? '编辑知识条目' : '新增知识条目'}
          wide
          onClose={closeForm}
          onSubmit={submitForm}
          saving={saving}
          error={formError}
          submitLabel={editing ? '保存' : '创建'}
          savingLabel="保存中…"
        >
          <div className="field">
            <label htmlFor="k-category">类别 *</label>
            <select
              id="k-category"
              className="select"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value as CategoryKey }))}
            >
              {KNOWLEDGE_CATEGORIES.map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="field">
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
          <div className="field">
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
          <div className="field-lg">
            <label htmlFor="k-tags">标签（逗号分隔，最多 10 个，单个 ≤20 字）</label>
            <input
              id="k-tags"
              className="input"
              value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              placeholder="例：高温补贴, 权益政策"
            />
          </div>
        </ModalForm>
      )}
    </>
  );
}
