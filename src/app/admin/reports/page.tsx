'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Report } from '@/lib/types';
import { REPORT_CATEGORY_LABELS } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭',
};
const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-amber', processing: 'badge-blue', resolved: 'badge-green', closed: 'badge-red',
};

export default function AdminReportsPage() {
  const [items, setItems] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' });
      if (status) p.set('status', status);
      const r = await fetch(`/api/admin/reports?${p}`);
      const j = await r.json() as { ok: boolean; data?: { items: Report[]; total: number } };
      if (j.ok && j.data) { setItems(j.data.items); setTotal(j.data.total); }
    } finally { setLoading(false); }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  async function createWorkOrder(reportId: string) {
    const res = await fetch('/api/admin/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '处理上报', source_report_id: reportId, priority: 'normal' }),
    });
    const j = await res.json() as { ok: boolean };
    if (j.ok) { alert('工单已创建'); void load(); }
    else alert('创建失败');
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>上报管理</h1>
        <select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="processing">处理中</option>
          <option value="resolved">已解决</option>
          <option value="closed">已关闭</option>
        </select>
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['服务点', '问题类型', '描述', '状态', '时间', '操作'].map(h => (
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
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无上报</td></tr>
            ) : items.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <a href={`/admin/points/${r.point_id}`} style={{ textDecoration: 'none', color: 'inherit', fontSize: '0.82rem' }}>
                    {r.point_id.slice(0, 8)}…
                  </a>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                  {REPORT_CATEGORY_LABELS[r.category] ?? r.category}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.content}
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? ''}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                  {new Date(r.created_at * 1000).toLocaleDateString('zh-CN')}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                  {r.status === 'pending' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => createWorkOrder(r.id)}>建工单</button>
                  )}
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
    </>
  );
}
