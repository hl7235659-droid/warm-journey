'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCanWrite } from '../admin-context';
import type { WorkOrder } from '@/lib/types';
import { WORK_ORDER_STATUS_LABELS, PRIORITY_LABELS } from '@/lib/types';

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-amber', in_progress: 'badge-blue', resolved: 'badge-green', closed: 'badge-red',
};
const PRIORITY_BADGE: Record<string, string> = {
  low: '', normal: 'badge-blue', high: 'badge-amber', urgent: 'badge-red',
};

export default function AdminWorkOrdersPage() {
  const canWrite = useCanWrite();
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' });
      if (status) p.set('status', status);
      const r = await fetch(`/api/admin/work-orders?${p}`);
      const j = await r.json() as { ok: boolean; data?: { items: WorkOrder[]; total: number } };
      if (j.ok && j.data) { setItems(j.data.items); setTotal(j.data.total); }
    } finally { setLoading(false); }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  function openEdit(wo: WorkOrder) { setEditing(wo); setEditStatus(wo.status); setEditNote(''); }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/work-orders/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editStatus, resolution_notes: editNote || undefined }),
      });
      const j = await r.json() as { ok: boolean; error?: string };
      if (j.ok) { setEditing(null); void load(); }
      else alert(j.error ?? '更新失败');
    } finally { setSaving(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>工单管理</h1>
        <select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="in_progress">处理中</option>
          <option value="resolved">已解决</option>
          <option value="closed">已关闭</option>
        </select>
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['标题', '优先级', '状态', '指派给', '创建时间', '操作'].map(h => (
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
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无工单</td></tr>
            ) : items.map(w => (
              <tr key={w.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.title}
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${PRIORITY_BADGE[w.priority] ?? ''}`}>{PRIORITY_LABELS[w.priority] ?? w.priority}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${STATUS_BADGE[w.status] ?? ''}`}>{WORK_ORDER_STATUS_LABELS[w.status] ?? w.status}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  {w.assigned_to ?? '—'}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                  {new Date(w.created_at * 1000).toLocaleDateString('zh-CN')}
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(w)}>更新</button>}
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

      {/* Edit modal */}
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>更新工单状态</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>{editing.title}</p>
            <div style={{ marginBottom: '1rem' }}>
              <label>状态</label>
              <select className="select" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                <option value="open">待处理</option>
                <option value="in_progress">处理中</option>
                <option value="resolved">已解决</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label>处理备注</label>
              <textarea className="textarea" rows={3} value={editNote}
                onChange={e => setEditNote(e.target.value)} placeholder="可选备注…" />
            </div>
            <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
