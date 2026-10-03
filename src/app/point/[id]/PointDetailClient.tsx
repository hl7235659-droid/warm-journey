'use client';

import { useState } from 'react';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';

interface Props { point: ServicePoint }

const SERVICE_ICONS: Record<string, string> = {
  '休息区': '🛋️', '充电': '🔋', '饮用水': '💧', '急救箱': '🩺',
  '雨具': '☂️', '厕所': '🚻', '餐饮': '🍱', '停车': '🅿️', 'Wi-Fi': '📶',
};

function navToPoint(lat: number, lng: number, name: string) {
  const ua = navigator.userAgent;
  const encoded = encodeURIComponent(name);
  if (/iPhone|iPad|iPod/.test(ua)) {
    window.location.href = `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encoded}`;
  } else {
    window.open(`https://uri.amap.com/navigation?to=${lng},${lat},${encoded}&mode=walking&callnative=1`, '_blank');
  }
}

export default function PointDetailClient({ point }: Props) {
  const [copied, setCopied] = useState(false);
  const statusClass = { open: 'badge-green', closed: 'badge-red', temp_closed: 'badge-amber' }[point.status];
  const updatedDate = new Date(point.updated_at * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  function copyAddress() {
    navigator.clipboard.writeText(point.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      {/* Navbar */}
      <nav className="navbar">
        <a href="/" className="btn btn-ghost btn-sm" aria-label="返回列表" style={{ padding: '0 0.5rem' }}>
          ← 返回
        </a>
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {point.name}
        </span>
      </nav>

      <main className="page" style={{ paddingTop: '1.25rem' }}>
        {/* Status header */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem' }}>{point.name}</h1>
            <span className={`badge ${statusClass}`} style={{ flexShrink: 0, fontSize: '0.85rem', padding: '0.3rem 0.7rem' }}>
              {STATUS_LABELS[point.status]}
            </span>
          </div>

          {/* Address row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ flexShrink: 0, marginTop: '1px' }}>📍</span>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', flex: 1 }}>{point.address}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={copyAddress}
              aria-label="复制地址"
              style={{ flexShrink: 0, padding: '0 0.5rem', minHeight: '32px' }}
            >
              {copied ? '✓' : '复制'}
            </button>
          </div>

          {/* Hours row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🕐</span>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{point.open_hours}</span>
          </div>

          {/* Phone */}
          {point.contact_phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <span>📞</span>
              <a href={`tel:${point.contact_phone}`} style={{ fontSize: '0.9rem' }}>{point.contact_phone}</a>
            </div>
          )}
        </div>

        {/* Navigate CTA */}
        <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem' }}>
          <button
            className="btn btn-primary btn-lg"
            style={{ flex: 1 }}
            onClick={() => navToPoint(point.lat, point.lng, point.name)}
          >
            🧭 开始导航
          </button>
          <a
            href={`/point/${point.id}/report`}
            className="btn btn-secondary btn-lg"
            style={{ flexShrink: 0 }}
            aria-label="上报异常"
          >
            🚩 上报
          </a>
        </div>

        {/* Services */}
        {point.services.length > 0 && (
          <section className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              服务项目
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {point.services.map(s => (
                <span key={s} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.4rem 0.75rem', background: 'var(--n-100)',
                  borderRadius: 'var(--r-md)', fontSize: '0.875rem', fontWeight: 500,
                  border: '1px solid var(--border-subtle)',
                }}>
                  {SERVICE_ICONS[s] ?? '✅'} {s}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Admission */}
        {(point.admission.platform_required || point.admission.id_required || point.admission.capacity || point.admission.notes) && (
          <section className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              准入要求
            </h2>
            <div className="stack-sm">
              {point.admission.platform_required ? (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span>🏢</span>
                  <span style={{ fontSize: '0.9rem' }}>仅限 <strong>{point.admission.platform_required}</strong> 骑手</span>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span>🏢</span>
                  <span style={{ fontSize: '0.9rem' }}>所有平台骑手均可进入</span>
                </div>
              )}
              {point.admission.id_required && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span>🪪</span>
                  <span style={{ fontSize: '0.9rem' }}>需出示骑手工牌 / 接单截图</span>
                </div>
              )}
              {point.admission.capacity && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span>👥</span>
                  <span style={{ fontSize: '0.9rem' }}>同时容纳 <strong>{point.admission.capacity}</strong> 人</span>
                </div>
              )}
              {point.admission.notes && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>ℹ️</span>
                  <span style={{ fontSize: '0.9rem' }}>{point.admission.notes}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Notes */}
        {point.notes && (
          <section className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              备注
            </h2>
            <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.7 }}>{point.notes}</p>
          </section>
        )}

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '1.5rem' }}>
          信息最后更新：{updatedDate}
          {point.verified_at && '  ·  已核验'}
        </p>

        <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
          <a href={`/point/${point.id}/report`} style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            🚩 信息有误？点此上报
          </a>
        </div>
      </main>
    </>
  );
}
