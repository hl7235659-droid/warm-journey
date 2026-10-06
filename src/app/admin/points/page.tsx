'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useCanWrite } from '../admin-context';
import { EmptyRow, LIST_PAGE_SIZE, Pager, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import type { PagedResult, ServicePoint } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';
import { api } from '@/lib/api-client';

const STATUS_BADGE: Record<ServicePoint['status'], string> = {
  open: 'badge-green', closed: 'badge-red', temp_closed: 'badge-amber',
};

export default function AdminPointsPage() {
  const canWrite = useCanWrite();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const fetchPoints = useCallback(async (page: number): Promise<ListResp<ServicePoint>> => {
    const p = new URLSearchParams({ page: String(page), page_size: String(LIST_PAGE_SIZE) });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    const j = await api<PagedResult<ServicePoint>>(`/api/admin/points?${p}`);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data.items, total: j.data.total };
  }, [q, status]);

  const { items, page, totalPages, loading, error, setPage } = useAdminList(fetchPoints);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">服务点管理</h1>
        {canWrite && <Link href="/admin/points/new" className="btn btn-primary btn-sm">+ 新增</Link>}
      </div>

      {/* Filters */}
      <div className="field" style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
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

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['名称', '地址', '营业时间', '状态', '已核验', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={6} /> : items.length === 0 ? <EmptyRow cols={6} text="暂无数据" /> :
              items.map(p => (
                <tr key={p.id}>
                  <td className="td-name">
                    <a href={`/admin/points/${p.id}`} className="cell-link">{p.name}</a>
                  </td>
                  <td className="td-muted ellipsis" style={{ maxWidth: '200px' }}>{p.address}</td>
                  <td className="td-muted td-nowrap">{p.open_hours}</td>
                  <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status]}</span></td>
                  <td style={{ textAlign: 'center' }}>{p.verified_at ? '✅' : '—'}</td>
                  <td className="td-nowrap">
                    {canWrite && <a href={`/admin/points/${p.id}`} className="btn btn-ghost btn-sm" style={{ marginRight: '0.375rem' }}>编辑</a>}
                    <a href={`/admin/points/${p.id}/history`} className="btn btn-ghost btn-sm">历史</a>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </>
  );
}
