'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCanWrite } from '../admin-context';
import { EmptyRow, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import type { PagedResult, Visit, VisitFeedback } from '@/lib/types';
import { VISIT_STATUS_LABELS } from '@/lib/types';
import type { ChatResponse } from '@/lib/ai/types';
import { api, ACTION_ERR } from '@/lib/api-client';

const STATUS_BADGE: Record<Visit['status'], string> = {
  reserved: 'badge-blue', in_store: 'badge-green', completed: 'badge-amber',
  cancelled: 'badge-red', expired: 'badge-red',
};

function fmtTime(ts: number | null) {
  return ts ? new Date(ts * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function Stars({ n }: { n: number }) {
  return <span style={{ color: 'var(--gold-500, #d4a017)', letterSpacing: '0.1em' }}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

export default function AdminVisitsPage() {
  const canWrite = useCanWrite();
  const [status, setStatus] = useState('in_store');
  const [feedback, setFeedback] = useState<VisitFeedback[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);

  const fetchVisits = useCallback(async (page: number): Promise<ListResp<Visit>> => {
    const p = new URLSearchParams({ page: String(page), page_size: '50' });
    if (status) p.set('status', status);
    const j = await api<PagedResult<Visit>>(`/api/admin/visits?${p}`);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data.items, total: j.data.total };
  }, [status]);

  const { items, loading, error, setPage, reload } = useAdminList(fetchVisits);

  const loadFeedback = useCallback(async () => {
    const j = await api<{ items: VisitFeedback[]; avg_rating: number | null }>('/api/admin/feedback?page_size=10');
    if (j.ok && j.data) { setFeedback(j.data.items); setAvgRating(j.data.avg_rating); }
  }, []);

  useEffect(() => { void loadFeedback(); }, [loadFeedback]);

  async function forceCheckout(v: Visit) {
    if (!window.confirm(`确定让 ${v.point_name ?? '该点'} 的这位骑手（${v.rider_token.slice(0, 6)}…）强制离店？`)) return;
    const j = await api(`/api/admin/visits/${v.id}`, { method: 'PUT' });
    if (j.ok) reload();
    else alert(j.error ?? ACTION_ERR);
  }

  function duration(v: Visit) {
    if (v.status !== 'in_store' || !v.checked_in_at) return '—';
    const mins = Math.max(1, Math.floor((Date.now() / 1000 - v.checked_in_at) / 60));
    return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`;
  }

  // T3：AI 周报——聚合近 7 天离店反馈（supports 分布 + 建议原文）→ /api/ai/chat
  // 提供商走服务端 Pages 环境变量 AI_*（audience=admin 需管理员登录）；
  // 管理端不读取 C 端悬浮窗的本地 provider 配置（避免跨端借用用户个人 Key）。
  async function generateReport() {
    setReportLoading(true);
    setReportText(null);
    const j = await api<{ items: VisitFeedback[] }>('/api/admin/feedback?page_size=200');
    const all = (j.ok && j.data ? j.data.items : []);
    const weekAgo = Date.now() / 1000 - 7 * 86400;
    const week = all.filter(f => f.created_at >= weekAgo);

    const totalW = week.length;
    const avg = totalW > 0 ? Math.round(week.reduce((s, f) => s + f.rating, 0) / totalW * 10) / 10 : null;
    const supportsCount = new Map<string, number>();
    for (const f of week) for (const s of f.supports) supportsCount.set(s, (supportsCount.get(s) ?? 0) + 1);
    const dist = [...supportsCount.entries()].sort((a, b) => b[1] - a[1]);
    const suggestions = week.map(f => (f.suggestion || '').trim()).filter(Boolean).slice(0, 8);

    const dataText =
      `时间范围：近 7 天（${new Date(weekAgo * 1000).toLocaleDateString('zh-CN')} 至 ${new Date().toLocaleDateString('zh-CN')}）\n` +
      `反馈总量：${totalW} 条${avg !== null ? `，平均评分 ${avg}（满分 5）` : ''}\n` +
      `希望获得的支持分布（被勾选次数）：${dist.length > 0 ? dist.map(([t, n]) => `${t} ${n} 次`).join('、') : '暂无'}\n` +
      (suggestions.length > 0 ? `近期建议原文（最多8条）：\n${suggestions.map(s => `- "${s.slice(0, 60)}"`).join('\n')}` : '近期无文字建议');

    try {
      // /api/ai/chat 的成功响应把 text/mode 放在顶层（非 { ok, data } 信封），故这一处不走 api()
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'admin',
          dataText,
          messages: [{ role: 'user', content: '请根据统计数据生成本周离店反馈运营周报。' }],
        }),
      });
      const json = await res.json() as ChatResponse;
      setReportText(json.ok && json.text ? `${json.text}${json.mode === 'local' ? '\n\n（本地统计模式——未连接大模型）' : ''}` : (json.error ?? '生成失败，请稍后重试'));
    } catch {
      setReportText('生成失败：网络异常');
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">在店管理</h1>
        <div className="flow-row">
          <button className="btn btn-primary btn-sm" onClick={generateReport} disabled={reportLoading}>
            {reportLoading ? '生成中…' : 'AI 周报'}
          </button>
          <select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
            <option value="in_store">当前在店</option>
            <option value="reserved">已预约</option>
            <option value="completed">已离店</option>
            <option value="">全部记录</option>
          </select>
        </div>
      </div>

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap" style={{ marginBottom: '2rem' }}>
        <table>
          <thead>
            <tr>
              {['服务点', '骑手', '状态', '预约时间', '入店时间', '在店时长', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={7} /> : items.length === 0 ? (
              <EmptyRow cols={7} text={status === 'in_store' ? '当前无人在店' : '暂无记录'} />
            ) : items.map(v => (
              <tr key={v.id}>
                <td className="td-name">
                  <a href={`/admin/points/${v.point_id}`} className="cell-link">
                    {v.point_name ?? v.point_id.slice(0, 8) + '…'}
                  </a>
                </td>
                <td className="td-muted" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {v.rider_token.slice(0, 8)}…
                </td>
                <td><span className={`badge ${STATUS_BADGE[v.status]}`}>{VISIT_STATUS_LABELS[v.status]}</span></td>
                <td className="td-time">{fmtTime(v.reserved_at)}</td>
                <td className="td-time">{fmtTime(v.checked_in_at)}</td>
                <td className="td-meta">{duration(v)}</td>
                <td>
                  {v.status === 'in_store' && canWrite && (
                    <button className="btn btn-ghost btn-sm" onClick={() => forceCheckout(v)}>强制离店</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* AI 周报结果 */}
      {reportText && (
        <div className="modal-backdrop" onClick={() => setReportText(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">AI 周报 · 近 7 天离店反馈</h2>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem', lineHeight: 1.7, fontFamily: 'var(--font-sans)', color: 'var(--text-body)' }}>
              {reportText}
            </div>
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setReportText(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 离店满意度反馈 */}
      <div className="page-head is-baseline" style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>离店反馈</h2>
        {avgRating !== null && (
          <span className="pager-info">平均 <Stars n={Math.round(avgRating)} /> {avgRating} 分</span>
        )}
      </div>
      <div className="stack-sm">
        {feedback.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '1rem 0' }}>暂无反馈——骑手离店后会看到满意度卡片。</p>
        ) : feedback.map(f => (
          <div key={f.id} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div className="flow-row" style={{ gap: '0.75rem', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{f.point_name ?? '服务点'}</span>
              <Stars n={f.rating} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{fmtTime(f.created_at)}</span>
            </div>
            {f.supports.length > 0 && (
              <div className="flow-row" style={{ marginTop: '0.5rem' }}>
                {f.supports.map(s => <span key={s} className="tag">{s}</span>)}
              </div>
            )}
            {f.suggestion && (
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
                「{f.suggestion}」
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
