'use client';
export const runtime = 'edge';

import { useState, useEffect, useCallback } from 'react';
import type { Visit, VisitFeedback } from '@/lib/types';
import { VISIT_STATUS_LABELS } from '@/lib/types';

const STATUS_BADGE: Record<string, string> = {
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
  const [items, setItems] = useState<Visit[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('in_store');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<VisitFeedback[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page_size: '50' });
      if (status) p.set('status', status);
      const r = await fetch(`/api/admin/visits?${p}`);
      const j = await r.json() as { ok: boolean; data?: { items: Visit[]; total: number } };
      if (j.ok && j.data) { setItems(j.data.items); setTotal(j.data.total); }
    } finally { setLoading(false); }
  }, [status]);

  const loadFeedback = useCallback(async () => {
    const r = await fetch('/api/admin/feedback?page_size=10');
    const j = await r.json() as { ok: boolean; data?: { items: VisitFeedback[]; avg_rating: number | null } };
    if (j.ok && j.data) { setFeedback(j.data.items); setAvgRating(j.data.avg_rating); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadFeedback(); }, [loadFeedback]);

  async function forceCheckout(v: Visit) {
    if (!window.confirm(`确定让 ${v.point_name ?? '该点'} 的这位骑手（${v.rider_token.slice(0, 6)}…）强制离店？`)) return;
    const r = await fetch(`/api/admin/visits/${v.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_checkout' }),
    });
    const j = await r.json() as { ok: boolean; error?: string };
    if (j.ok) void load();
    else alert(j.error ?? '操作失败');
  }

  function duration(v: Visit) {
    if (v.status !== 'in_store' || !v.checked_in_at) return '—';
    const mins = Math.max(1, Math.floor((Date.now() / 1000 - v.checked_in_at) / 60));
    return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`;
  }

  // T3：AI 周报——聚合近 7 天离店反馈（supports 分布 + 建议原文）→ /api/ai/chat
  // 提供商优先级：本机 wj_ai_providers（C 端悬浮窗配置）→ Pages 环境变量 AI_* → 本地统计摘要
  async function generateReport() {
    setReportLoading(true);
    setReportText(null);
    try {
      const r = await fetch('/api/admin/feedback?page_size=200');
      const j = await r.json() as { ok: boolean; data?: { items: VisitFeedback[] } };
      const all = j.data?.items ?? [];
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

      // 本机提供商（与 C 端悬浮窗共用 localStorage）
      let provider: { baseUrl: string; apiKey: string; model: string; temperature: number } | undefined;
      try {
        const store = JSON.parse(localStorage.getItem('wj_ai_providers') ?? 'null') as
          { providers?: Array<{ id: string; baseUrl: string; apiKey: string; model: string; temperature: number }>; activeId: string | null } | null;
        const p = store?.providers?.find(x => x.id === store.activeId && x.apiKey);
        if (p) provider = { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, temperature: p.temperature ?? 0.3 };
      } catch { /* ignore */ }

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'admin',
          dataText,
          provider,
          messages: [{ role: 'user', content: '请根据统计数据生成本周离店反馈运营周报。' }],
        }),
      });
      const json = await res.json() as { ok: boolean; text?: string; error?: string; mode?: string };
      setReportText(json.ok && json.text ? `${json.text}${json.mode === 'local' ? '\n\n（本地统计模式——未连接大模型）' : ''}` : (json.error ?? '生成失败，请稍后重试'));
    } catch {
      setReportText('生成失败：网络异常');
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>在店管理</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={generateReport} disabled={reportLoading}>
            {reportLoading ? '生成中…' : 'AI 周报'}
          </button>
          <select className="select" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="in_store">当前在店</option>
            <option value="reserved">已预约</option>
            <option value="completed">已离店</option>
            <option value="">全部记录</option>
          </select>
        </div>
      </div>

      <div className="table-wrap" style={{ marginBottom: '2rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['服务点', '骑手', '状态', '预约时间', '入店时间', '在店时长', '操作'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [1,2,3].map(i => (
              <tr key={i}>{[1,2,3,4,5,6,7].map(j => (
                <td key={j} style={{ padding: '0.75rem' }}><div className="skeleton" style={{ height: '16px', borderRadius: '4px' }} /></td>
              ))}</tr>
            )) : items.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                {status === 'in_store' ? '当前无人在店' : '暂无记录'}
              </td></tr>
            ) : items.map(v => (
              <tr key={v.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <a href={`/admin/points/${v.point_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    {v.point_name ?? v.point_id.slice(0, 8) + '…'}
                  </a>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {v.rider_token.slice(0, 8)}…
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${STATUS_BADGE[v.status] ?? ''}`}>{VISIT_STATUS_LABELS[v.status]}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtTime(v.reserved_at)}</td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtTime(v.checked_in_at)}</td>
                <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.82rem' }}>{duration(v)}</td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  {v.status === 'in_store' && (
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
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>AI 周报 · 近 7 天离店反馈</h2>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>离店反馈</h2>
        {avgRating !== null && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            平均 <Stars n={Math.round(avgRating)} /> {avgRating} 分
          </span>
        )}
      </div>
      <div className="stack-sm">
        {feedback.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '1rem 0' }}>暂无反馈——骑手离店后会看到满意度卡片。</p>
        ) : feedback.map(f => (
          <div key={f.id} className="card" style={{ padding: '0.875rem 1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{f.point_name ?? '服务点'}</span>
              <Stars n={f.rating} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>{fmtTime(f.created_at)}</span>
            </div>
            {f.supports.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.5rem' }}>
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
