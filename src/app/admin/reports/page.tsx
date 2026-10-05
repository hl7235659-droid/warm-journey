'use client';

import { useCallback, useState } from 'react';
import { EmptyRow, LIST_PAGE_SIZE, Pager, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import type { PagedResult, Report } from '@/lib/types';
import { REPORT_CATEGORY_LABELS, REPORT_STATUS_LABELS } from '@/lib/types';
import { api } from '@/lib/api-client';

const STATUS_BADGE: Record<Report['status'], string> = {
  pending: 'badge-amber', processing: 'badge-blue', resolved: 'badge-green', closed: 'badge-red',
};

export default function AdminReportsPage() {
  const [status, setStatus] = useState('');

  const fetchReports = useCallback(async (page: number): Promise<ListResp<Report>> => {
    const p = new URLSearchParams({ page: String(page), page_size: String(LIST_PAGE_SIZE) });
    if (status) p.set('status', status);
    const j = await api<PagedResult<Report>>(`/api/admin/reports?${p}`);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data.items, total: j.data.total };
  }, [status]);

  const { items, page, totalPages, loading, error, setPage, reload } = useAdminList(fetchReports);

  async function createWorkOrder(reportId: string) {
    // API 入参是 report_id（此前误传 source_report_id，zod 静默丢弃导致工单永远关联不上上报）
    const j = await api('/api/admin/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '处理上报', report_id: reportId, priority: 'normal' }),
    });
    if (j.ok) { alert('工单已创建'); reload(); }
    else alert(j.error ?? '创建失败');
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">上报管理</h1>
        <select className="select" value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          style={{ width: 'auto' }}>
          <option value="">全部状态</option>
          {(Object.keys(REPORT_STATUS_LABELS) as Report['status'][]).map(s => (
            <option key={s} value={s}>{REPORT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['服务点', '问题类型', '描述', '状态', '时间', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={6} /> : items.length === 0 ? <EmptyRow cols={6} text="暂无上报" /> :
              items.map(r => (
                <tr key={r.id}>
                  <td className="td-name">
                    <a href={`/admin/points/${r.point_id}`} className="cell-link td-meta">
                      {r.point_name ?? r.point_id.slice(0, 8) + '…'}
                    </a>
                  </td>
                  <td className="td-nowrap">{REPORT_CATEGORY_LABELS[r.category] ?? r.category}</td>
                  <td className="td-muted" style={{ maxWidth: '240px' }}>
                    <div className="ellipsis">{r.content}</div>
                    {r.images.length > 0 && (
                      <div className="flow-row" style={{ marginTop: '0.375rem' }}>
                        {r.images.map(key => (
                          <a key={key} href={`/api/images/${key}`} target="_blank" rel="noreferrer">
                            <img src={`/api/images/${key}`} alt="上报照片" className="thumb" />
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{REPORT_STATUS_LABELS[r.status]}</span></td>
                  <td className="td-time">{new Date(r.created_at * 1000).toLocaleDateString('zh-CN')}</td>
                  <td className="td-nowrap">
                    {r.status === 'pending' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => createWorkOrder(r.id)}>建工单</button>
                    )}
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
