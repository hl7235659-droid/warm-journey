'use client';
export const runtime = 'edge';

import { useState, useEffect, useCallback } from 'react';
import { useCanWrite } from '../admin-context';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';

export default function AdminPointsPage() {
  const canWrite = useCanWrite();
  const [points, setPoints] = useState<ServicePoint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetch_ = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      const res = await fetch(`/api/admin/points?${p}`);
      if (!res.ok) { setError('加载失败'); return; }
      const j = await res.json() as { ok: boolean; data?: { items: ServicePoint[]; total: number } };
      if (j.ok && j.data) { setPoints(j.data.items); setTotal(j.data.total); }
    } catch { setError('网络异常'); } finally { setLoading(false); }
  }, [page, q, status]);

  useEffect(() => { void fetch_(); }, [fetch_]);

  const totalPages = Math.max(1, Math.ceil(total / 20));
  const statusBadge = { open: 'badge-green', closed: 'badge-red', temp_closed: 'badge-amber' };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>服务点管理</h1>
        {canWrite && <a href="/admin/points/new" className="btn btn-primary btn-sm">+ 新增</a>}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: '1 1 200px', maxWidth: '320px' }}
          placeholder="搜索名称或地址…" value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }} />
        <select className="select" value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          style={{ flex: '0 0 auto', width: 'auto' }}>
          <option value="">全部状态</option>
          <option value="open">开放中</option>
          <option value="closed">已关闭</option>
          <option value="temp_closed">临时关闭</option>
        </select>
      </div>

      {error && <p className="field-error" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['名称', '地址', '营业时间', '状态', '已核验', '操作'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600,
                  color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1,2,3,4].map(i => (
                <tr key={i}>
                  {[1,2,3,4,5,6].map(j => (
                    <td key={j} style={{ padding: '0.75rem' }}>
                      <div className="skeleton" style={{ height: '18px', borderRadius: '4px' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : points.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                暂无数据
              </td></tr>
            ) : points.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <a href={`/admin/points/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>{p.name}</a>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', maxWidth: '200px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.address}</td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.open_hours}</td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${statusBadge[p.status]}`}>{STATUS_LABELS[p.status]}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center' }}>
                  {p.verified_at ? '✅' : '—'}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                  {canWrite && <a href={`/admin/points/${p.id}`} className="btn btn-ghost btn-sm" style={{ marginRight: '0.375rem' }}>编辑</a>}
                  <a href={`/admin/points/${p.id}/history`} className="btn btn-ghost btn-sm">历史</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
