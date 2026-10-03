'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Inspection } from '@/lib/types';
import { INSPECTION_RESULT_LABELS } from '@/lib/types';

const RESULT_BADGE: Record<string, string> = {
  pass: 'badge-green', fail: 'badge-red', needs_attention: 'badge-amber',
};

export default function AdminInspectionsPage() {
  const [items, setItems] = useState<Inspection[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ point_id: '', result: 'pass', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' });
      const r = await fetch(`/api/admin/inspections?${p}`);
      const j = await r.json() as { ok: boolean; data?: { items: Inspection[]; total: number } };
      if (j.ok && j.data) { setItems(j.data.items); setTotal(j.data.total); }
    } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.point_id.trim()) { alert('请输入服务点 ID'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json() as { ok: boolean; error?: string };
      if (j.ok) { setShowForm(false); setForm({ point_id: '', result: 'pass', notes: '' }); void load(); }
      else alert(j.error ?? '提交失败');
    } finally { setSaving(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>巡检记录</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ 新建巡检</button>
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['服务点', '结果', '巡检员', '备注', '时间'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [1,2,3].map(i => (
              <tr key={i}>{[1,2,3,4,5].map(j => (
                <td key={j} style={{ padding: '0.75rem' }}><div className="skeleton" style={{ height: '16px', borderRadius: '4px' }} /></td>
              ))}</tr>
            )) : items.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无巡检记录</td></tr>
            ) : items.map(ins => (
              <tr key={ins.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <a href={`/admin/points/${ins.point_id}`} style={{ textDecoration: 'none', color: 'inherit', fontSize: '0.82rem' }}>
                    {ins.point_id.slice(0, 8)}…
                  </a>
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${RESULT_BADGE[ins.result] ?? ''}`}>{INSPECTION_RESULT_LABELS[ins.result] ?? ins.result}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  {ins.inspector_id ? ins.inspector_id.slice(0, 8) + '…' : '—'}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ins.notes ?? '—'}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                  {new Date(ins.created_at * 1000).toLocaleDateString('zh-CN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← 上一页</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页 →</button>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>新建巡检记录</h2>
            <form onSubmit={submit} noValidate>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="ins-point">服务点 ID</label>
                <input id="ins-point" className="input" value={form.point_id}
                  onChange={e => setForm(f => ({ ...f, point_id: e.target.value }))}
                  placeholder="粘贴服务点 ID" required />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label>巡检结果</label>
                <select className="select" value={form.result}
                  onChange={e => setForm(f => ({ ...f, result: e.target.value }))}>
                  <option value="pass">通过</option>
                  <option value="needs_attention">需关注</option>
                  <option value="fail">不通过</option>
                </select>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="ins-notes">备注</label>
                <textarea id="ins-notes" className="textarea" rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="可选…" />
              </div>
              <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '提交中…' : '提交'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
