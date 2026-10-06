'use client';

import { useState, useEffect } from 'react';
import { REPORT_CATEGORY_LABELS, REPORT_STATUS_LABELS } from '@/lib/types';
import type { ReportStatus } from '@/lib/types';
import type { ReportStatusPublic } from '@/lib/db';
import { api } from '@/lib/api-client';
import { LS_KEYS, MY_REPORTS_MAX, readList } from '@/lib/local';
import type { MyReport } from '@/lib/local';

// 进度查询页只读这几个字段（响应里的 id 不参与展示）
type ReportStatusData = Pick<ReportStatusPublic,
  'point_id' | 'point_name' | 'category' | 'status' | 'created_at'>;

const STATUS_SEALS: Record<ReportStatus, string> = {
  pending: 'seal-gold',
  processing: 'seal-gold',
  resolved: 'seal-jade',
  closed: 'seal-ink',
};

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ReportStatusPage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReportStatusData | null>(null);
  const [myReports, setMyReports] = useState<MyReport[]>([]);

  useEffect(() => {
    setMyReports(readList<MyReport>(LS_KEYS.myReports, MY_REPORTS_MAX));
  }, []);

  async function query(c: string) {
    const trimmed = c.trim().toLowerCase();
    if (trimmed.length < 10) { setError('查询码为 10 位字符'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    const json = await api<ReportStatusData>(`/api/reports/status?code=${encodeURIComponent(trimmed)}`);
    if (!json.ok) setError(json.error ?? '查询失败，请重试');
    else setResult(json.data);
    setLoading(false);
  }

  return (
    <div className="slide">
      <nav className="navbar">
        <a href="/" className="btn btn-ghost btn-sm" aria-label="返回首页" style={{ padding: '0 0.5rem', color: 'var(--gold-300)' }}>← 返回</a>
        <span className="navbar-title">上报进度查询</span>
      </nav>

      <main className="page" style={{ paddingTop: '1.25rem', paddingBottom: '2.5rem' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem', fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
          输入上报成功后得到的查询码，查看处理进度。无需登录。
        </p>

        <form
          onSubmit={e => { e.preventDefault(); void query(code); }}
          style={{ display: 'flex', gap: '0.625rem', marginBottom: '1.5rem' }}
        >
          <input
            className="input"
            type="text"
            inputMode="text"
            placeholder="输入 10 位查询码"
            value={code}
            onChange={e => setCode(e.target.value)}
            aria-label="查询码"
            style={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ flexShrink: 0 }}>
            {loading ? '查询中…' : '查询'}
          </button>
        </form>

        {error && (
          <p className="field-error" role="alert" style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>※ {error}</p>
        )}

        {result && (
          <section className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, letterSpacing: '0.1em', color: 'var(--red-800)' }}>
                {result.point_name ?? '服务点'}
              </h2>
              <span className={`seal ${STATUS_SEALS[result.status]}`}>
                {REPORT_STATUS_LABELS[result.status]}
              </span>
            </div>
            <div className="stack-sm">
              <p style={{ margin: 0, fontSize: '0.88rem', fontFamily: 'var(--font-sans)' }}>
                <span style={{ color: 'var(--text-muted)' }}>问题类型：</span>
                {REPORT_CATEGORY_LABELS[result.category]}
              </p>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-faint)', fontFamily: 'var(--font-sans)' }}>
                上报时间：{fmtDate(result.created_at)}
              </p>
            </div>
            <a href={`/point/${result.point_id}`} style={{ display: 'inline-block', marginTop: '0.75rem', fontSize: '0.85rem', fontFamily: 'var(--font-sans)' }}>
              查看服务点 →
            </a>
          </section>
        )}

        {myReports.length > 0 && (
          <section>
            <h2 className="sub-title">
              本机上报记录
            </h2>
            <div className="stack-sm">
              {myReports.map(r => (
                <button
                  key={r.code}
                  className="card"
                  onClick={() => { setCode(r.code); void query(r.code); }}
                  disabled={loading}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '0.75rem', width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '0.75rem 1rem',
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: '0.88rem', letterSpacing: '0.1em' }}>
                    {r.code}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', fontFamily: 'var(--font-sans)', flexShrink: 0 }}>
                    {new Date(r.ts).toLocaleDateString('zh-CN')}
                  </span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.5rem', fontFamily: 'var(--font-sans)' }}>
              记录仅保存在本机浏览器，换设备请使用查询码。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
