'use client';

import { useCallback, useState } from 'react';
import { useCanWrite } from '../admin-context';
import { EmptyRow, LIST_PAGE_SIZE, Pager, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import type { PagedResult, WorkOrder, WorkOrderStatus } from '@/lib/types';
import { PRIORITY_LABELS, WORK_ORDER_STATUS_LABELS } from '@/lib/types';
import { api } from '@/lib/api-client';
import { formatCNDate } from '@/lib/format';

const STATUS_KEYS = Object.keys(WORK_ORDER_STATUS_LABELS) as WorkOrderStatus[];
const STATUS_BADGE: Record<WorkOrderStatus, string> = {
  open: 'badge-amber', in_progress: 'badge-blue', resolved: 'badge-green', closed: 'badge-red',
};
const PRIORITY_BADGE: Record<WorkOrder['priority'], string> = {
  low: '', normal: 'badge-blue', high: 'badge-amber', urgent: 'badge-red',
};

export default function AdminWorkOrdersPage() {
  const canWrite = useCanWrite();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchOrders = useCallback(async (page: number): Promise<ListResp<WorkOrder>> => {
    const p = new URLSearchParams({ page: String(page), page_size: String(LIST_PAGE_SIZE) });
    if (status) p.set('status', status);
    const j = await api<PagedResult<WorkOrder>>(`/api/admin/work-orders?${p}`);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data.items, total: j.data.total };
  }, [status]);

  const { items, page, totalPages, loading, error, setPage, reload } = useAdminList(fetchOrders);

  function openEdit(wo: WorkOrder) { setEditing(wo); setEditStatus(wo.status); setEditNote(''); }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const j = await api(`/api/admin/work-orders/${editing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: editStatus, resolution_note: editNote || undefined }),
    });
    setSaving(false);
    if (j.ok) { setEditing(null); reload(); }
    else alert(j.error ?? '更新失败');
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">工单管理</h1>
        <select className="select" value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          style={{ width: 'auto' }}>
          <option value="">全部状态</option>
          {STATUS_KEYS.map(s => <option key={s} value={s}>{WORK_ORDER_STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['标题', '优先级', '状态', '创建时间', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={5} /> : items.length === 0 ? <EmptyRow cols={5} text="暂无工单" /> :
              items.map(w => (
                <tr key={w.id}>
                  <td className="td-name ellipsis" style={{ maxWidth: '200px' }}>{w.title}</td>
                  <td>
                    <span className={`badge ${PRIORITY_BADGE[w.priority]}`}>{PRIORITY_LABELS[w.priority]}</span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[w.status]}`}>{WORK_ORDER_STATUS_LABELS[w.status]}</span>
                  </td>
                  <td className="td-time">{formatCNDate(w.created_at)}</td>
                  <td>
                    {canWrite && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(w)}>更新</button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} />

      {/* Edit modal */}
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">更新工单状态</h2>
            <p className="hint">{editing.title}</p>
            <div className="field">
              <label>状态</label>
              <select className="select" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                {STATUS_KEYS.map(s => <option key={s} value={s}>{WORK_ORDER_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="field-lg">
              <label>处理备注</label>
              <textarea className="textarea" rows={3} value={editNote}
                onChange={e => setEditNote(e.target.value)} placeholder="可选备注…" />
            </div>
            <div className="modal-actions">
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
