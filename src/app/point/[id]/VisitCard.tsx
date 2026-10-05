'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Visit } from '@/lib/types';
import type { Occupancy } from '@/lib/db';
import { getRiderToken } from '@/lib/rider';
import { api } from '@/lib/api-client';
import QrImage from '@/components/qr';

interface Props {
  pointId: string;
  pointStatus: 'open' | 'closed' | 'temp_closed';
  initialOccupancy: Occupancy;
}

function fmtDuration(sinceTs: number, now: number) {
  const mins = Math.max(0, Math.floor((now - sinceTs) / 60));
  if (mins < 60) return `${mins} 分钟`;
  return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
}

export default function VisitCard({ pointId, pointStatus, initialOccupancy }: Props) {
  const [occupancy, setOccupancy] = useState(initialOccupancy);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [origin, setOrigin] = useState('');

  // 在店时长每 30 秒刷新（仅 in_store 时值得跑；依赖具体字段，避免每次 refresh 重建 interval）
  useEffect(() => {
    if (visit?.status !== 'in_store' || !visit.checked_in_at) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(t);
  }, [visit?.status, visit?.checked_in_at]);

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const refresh = useCallback(async () => {
    const json = await api<{ visit: Visit | null }>('/api/visits/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_id: pointId, rider_token: getRiderToken() }),
    });
    // 离线或业务失败：保持现状
    if (json.ok && json.data) setVisit(json.data.visit);
  }, [pointId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleReserve() {
    setBusy(true); setError('');
    const json = await api<{ visit: Visit; created: boolean }>(`/api/points/${pointId}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rider_token: getRiderToken() }),
    });
    if (!json.ok) { setError(json.error ?? '预约失败，请重试'); }
    else {
      setVisit(json.data.visit);
      // 用响应里的 created 标记做乐观更新，避免读到闭包里的旧 visit
      if (json.data.created && json.data.visit.status === 'reserved') {
        setOccupancy(o => ({ ...o, reserved: o.reserved + 1 }));
      }
    }
    setBusy(false);
  }

  async function handleCancel() {
    if (!visit) return;
    setBusy(true); setError('');
    const json = await api<{ visit: Visit | null }>(`/api/visits/${visit.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rider_token: getRiderToken() }),
    });
    if (!json.ok) setError(json.error ?? '取消失败');
    else {
      setVisit(null);
      setOccupancy(o => ({ ...o, reserved: Math.max(0, o.reserved - 1) }));
    }
    setBusy(false);
  }

  const { in_store, reserved, capacity } = occupancy;
  const used = in_store + reserved;
  const full = capacity !== null && used >= capacity;
  const ratio = capacity ? Math.min(1, used / capacity) : 0;
  const levelText = capacity === null ? `${in_store} 人在店`
    : full ? '名额已满'
    : ratio >= 0.7 ? '较拥挤'
    : '宽敞';

  return (
    <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '300ms' }}>
      <h2 className="sub-title">
        预约进店
      </h2>

      {/* 人数条 */}
      <div style={{ marginBottom: '0.875rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.375rem' }}>
          <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
            在店 <strong>{in_store}</strong> 人{reserved > 0 && <> · 预约未到 <strong>{reserved}</strong> 人</>}
            {capacity !== null && <> / 容纳 {capacity} 人</>}
          </span>
          <span className={`seal ${full ? 'seal-ink' : ratio >= 0.7 ? 'seal-gold' : 'seal-jade'}`} style={{ fontSize: '0.72rem' }}>
            {levelText}
          </span>
        </div>
        {capacity !== null && (
          <div style={{ height: '6px', borderRadius: '3px', background: 'var(--border-subtle)', overflow: 'hidden' }} role="progressbar"
            aria-valuenow={used} aria-valuemin={0} aria-valuemax={capacity} aria-label="名额占用">
            <div style={{
              height: '100%', width: `${ratio * 100}%`, borderRadius: '3px',
              background: full ? 'var(--danger)' : ratio >= 0.7 ? 'var(--gold-500, #b8860b)' : 'var(--jade, #2f7d5b)',
              transition: 'width .4s ease',
            }} />
          </div>
        )}
      </div>

      {error && <p className="field-error" role="alert" style={{ marginBottom: '0.75rem', fontSize: '0.88rem' }}>※ {error}</p>}

      {/* 状态区 */}
      {!visit ? (
        <button
          className="btn btn-primary btn-lg btn-full"
          onClick={handleReserve}
          disabled={busy || pointStatus === 'closed' || full}
        >
          {pointStatus === 'closed' ? '站点已关闭' : full ? '名额已满，稍后再试' : busy ? '预约中…' : '预约进店'}
        </button>
      ) : visit.status === 'reserved' ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem', fontFamily: 'var(--font-sans)' }}>
            已预约（名额保留 2 小时）。到店后请工作人员扫此码确认入店：
          </p>
          {origin && visit.checkin_code && (
            <QrImage value={`${origin}/checkin/${visit.id}?c=${visit.checkin_code}`} size={180} label="入店二维码" />
          )}
          {origin && !visit.checkin_code && (
            <p style={{ fontSize: '0.8rem', color: 'var(--cinnabar)', fontFamily: 'var(--font-sans)' }}>
              入店码缺失，请点击「刷新状态」或重新预约
            </p>
          )}
          <p style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-faint)', margin: '0.5rem 0 0.875rem', letterSpacing: '0.1em' }}>
            {visit.id}
          </p>
          <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={busy}>取消预约</button>
            <button className="btn btn-secondary btn-sm" onClick={() => void refresh()}>刷新状态</button>
          </div>
        </div>
      ) : visit.status === 'in_store' ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 0.5rem' }}>
            <span className="seal seal-jade">在 店</span>
          </p>
          <p style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)', margin: '0 0 0.25rem' }}>
            已入店{visit.checked_in_at ? ` ${fmtDuration(visit.checked_in_at, now)}` : ''}，离店时请扫店内「离店码」
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', fontFamily: 'var(--font-sans)', margin: '0 0 0.875rem' }}>
            超过 4 小时未离店将自动释放名额
          </p>
          <a href={`/checkout/${pointId}`} className="btn btn-secondary">去离店</a>
        </div>
      ) : null}
    </section>
  );
}
