'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { VISIT_STATUS_LABELS } from '@/lib/types';
import type { Visit } from '@/lib/types';
import { api, ACTION_ERR } from '@/lib/api-client';
import { formatCNDateTime } from '@/lib/format';
import type { ApiResponse } from '@/lib/types';

// 入店确认页只读这几个字段；rider_token 由服务端脱敏为「前 6 位 + …」
type VisitInfo = Pick<Visit,
  'id' | 'point_id' | 'point_name' | 'rider_token' | 'status' | 'reserved_at' | 'checked_in_at'>;

// 店内人员扫骑手入店码后打开的确认页（凭证 = 二维码携带的一次性入店码 ?c=）
export default function CheckinPage() {
  const { id } = useParams<{ id: string }>();
  const [visit, setVisit] = useState<VisitInfo | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // 入店码只存在于二维码完整 URL 中，不经接口下发
    const c = new URLSearchParams(window.location.search).get('c')?.trim().toLowerCase() ?? '';
    setCode(c);
    if (!/^[0-9a-z]{10}$/.test(c)) setError('未识别到入店码，请重新扫描骑手的完整二维码');

    // 404 = 二维码本身无效，需要专属提示，故这一处保留裸 fetch 读 HTTP 状态码
    fetch(`/api/visits/${id}`)
      .then(async r => {
        if (r.status === 404) { setNotFound(true); return; }
        const j = await r.json() as ApiResponse<{ visit: VisitInfo }>;
        if (j.ok) setVisit(j.data.visit);
      })
      .catch(() => setError('网络异常，请刷新重试'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCheckin() {
    setBusy(true); setError('');
    const j = await api<{ visit: VisitInfo }>(`/api/visits/${id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!j.ok) { setError(j.error ?? ACTION_ERR); return; }
    setDone(true);
  }

  return (
    <div className="slide">
      <nav className="navbar">
        <span className="navbar-title" style={{ margin: '0 auto' }}>入店确认</span>
      </nav>

      <main className="page" style={{ paddingTop: '2.5rem', paddingBottom: '3rem', textAlign: 'center' }}>
        {loading ? (
          <div className="skeleton" style={{ height: '180px', borderRadius: 'var(--r-lg)' }} />
        ) : notFound ? (
          <>
            <div className="done-seal" aria-hidden="true" style={{ background: 'var(--ink, #333)' }}>无</div>
            <h2 style={{ letterSpacing: '0.12em' }}>预约不存在</h2>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>二维码无效或已过期，请让骑手重新出示。</p>
          </>
        ) : done ? (
          <>
            <div className="done-seal" aria-hidden="true">入</div>
            <h2 style={{ letterSpacing: '0.12em' }}>已确认入店</h2>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
              {visit?.point_name} · 在店人数已更新
            </p>
          </>
        ) : visit && (
          <>
            <h2 style={{ letterSpacing: '0.12em', marginBottom: '0.5rem' }}>{visit.point_name}</h2>
            <div className="card" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
              <div className="stack-sm" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
                <p style={{ margin: 0 }}><span style={{ color: 'var(--text-muted)' }}>预约编号：</span><span style={{ fontFamily: 'monospace' }}>{visit.id}</span></p>
                <p style={{ margin: 0 }}><span style={{ color: 'var(--text-muted)' }}>骑手标识：</span>{visit.rider_token}</p>
                <p style={{ margin: 0 }}><span style={{ color: 'var(--text-muted)' }}>预约时间：</span>{formatCNDateTime(visit.reserved_at)}</p>
                <p style={{ margin: 0 }}><span style={{ color: 'var(--text-muted)' }}>当前状态：</span>{VISIT_STATUS_LABELS[visit.status]}</p>
              </div>
            </div>
            {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>※ {error}</p>}
            {visit.status === 'reserved' ? (
              <button
                className="btn btn-primary btn-lg btn-full"
                onClick={handleCheckin}
                disabled={busy || !/^[0-9a-z]{10}$/.test(code)}
              >
                {busy ? '确认中…' : '确认入店'}
              </button>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
                {visit.status === 'in_store' ? '该骑手已在店内，无需重复确认。' : '该预约已失效，请让骑手重新预约。'}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
