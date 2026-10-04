'use client';

import { useState } from 'react';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';
import { POINT_COVERS, COVER_FALLBACK } from '@/lib/covers';
import { Corners } from '@/components/ornaments';

interface Props { point: ServicePoint }

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
  const statusClass = { open: 'seal-jade', closed: 'seal-ink', temp_closed: 'seal-gold' }[point.status];
  const updatedDate = new Date(point.updated_at * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const cover = POINT_COVERS[point.id] ?? COVER_FALLBACK;
  const isPhoto = POINT_COVERS[point.id] !== undefined;

  function copyAddress() {
    navigator.clipboard.writeText(point.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="slide">
      {/* 朱漆抬头 */}
      <header className="band band-detail">
        <Corners />
        <div className="band-top anim-rise" style={{ marginBottom: '0.875rem' }}>
          <a href="/" className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem', color: 'var(--gold-300)' }}>
            ← 返回
          </a>
          <span style={{ flex: 1 }} />
          <span className={`seal ${statusClass} anim-stamp`} style={{ animationDelay: '300ms' }}>
            {STATUS_LABELS[point.status]}
          </span>
        </div>
        <h1 className="detail-title anim-rise" style={{ animationDelay: '80ms' }}>{point.name}</h1>
        <div className="detail-meta anim-rise" style={{ animationDelay: '160ms' }}>
          <div className="meta-row">
            <span className="mi-seal-light" aria-hidden="true"><i>址</i></span>
            <span className="meta-txt">{point.address}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={copyAddress}
              style={{ minHeight: '26px', padding: '0 0.5rem', color: 'var(--gold-300)', flexShrink: 0 }}
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <div className="meta-row">
            <span className="mi-seal-light" aria-hidden="true"><i>时</i></span>
            <span className="meta-txt">{point.open_hours}</span>
          </div>
          {point.contact_phone && (
            <div className="meta-row">
              <span className="mi-seal-light" aria-hidden="true"><i>话</i></span>
              <span className="meta-txt"><a href={`tel:${point.contact_phone}`}>{point.contact_phone}</a></span>
            </div>
          )}
        </div>
      </header>

      <main className="page" style={{ paddingTop: '1.125rem', paddingBottom: '2rem' }}>
        {/* 装裱封面 */}
        <div className="point-cover detail-cover anim-rise" style={{ animationDelay: '200ms' }}>
          <img src={cover} alt={isPhoto ? `${point.name} 实景` : `${point.name} 插画示意`} />
        </div>

        {/* Navigate CTA */}
        <div className="anim-rise" style={{ display: 'flex', gap: '0.625rem', margin: '1rem 0', animationDelay: '280ms' }}>
          <button
            className="btn btn-primary btn-lg"
            style={{ flex: 1 }}
            onClick={() => navToPoint(point.lat, point.lng, point.name)}
          >
            开始导航
          </button>
          <a
            href={`/point/${point.id}/report`}
            className="btn btn-secondary btn-lg"
            style={{ flexShrink: 0 }}
            aria-label="上报异常"
          >
            上报
          </a>
        </div>

        {/* Services — 素读点分隔 */}
        {point.services.length > 0 && (
          <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '340ms' }}>
            <h2 style={{ margin: '0 0 0.6rem', fontSize: '0.92rem', fontWeight: 900, letterSpacing: '0.16em', color: 'var(--red-800)' }}>
              服务项目
            </h2>
            <p className="svc-list">
              {point.services.map((s, i) => (
                <span key={s}>
                  {i > 0 && <i aria-hidden="true">·</i>}
                  {s}
                </span>
              ))}
            </p>
          </section>
        )}

        {/* Admission */}
        {(point.admission.platform_required || point.admission.id_required || point.admission.capacity || point.admission.notes) && (
          <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '400ms' }}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.92rem', fontWeight: 900, letterSpacing: '0.16em', color: 'var(--red-800)' }}>
              准入要求
            </h2>
            <div className="stack-sm">
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="mi-seal" aria-hidden="true"><i>平</i></span>
                <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
                  {point.admission.platform_required
                    ? <>仅限 <strong>{point.admission.platform_required}</strong> 骑手</>
                    : '所有平台骑手均可进入'}
                </span>
              </div>
              {point.admission.id_required && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="mi-seal" aria-hidden="true"><i>证</i></span>
                  <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>需出示骑手工牌 / 接单截图</span>
                </div>
              )}
              {point.admission.capacity && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="mi-seal" aria-hidden="true"><i>容</i></span>
                  <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>同时容纳 <strong>{point.admission.capacity}</strong> 人</span>
                </div>
              )}
              {point.admission.notes && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <span className="mi-seal" aria-hidden="true"><i>注</i></span>
                  <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>{point.admission.notes}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Notes */}
        {point.notes && (
          <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '460ms' }}>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.92rem', fontWeight: 900, letterSpacing: '0.16em', color: 'var(--red-800)' }}>
              备注
            </h2>
            <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.7, fontFamily: 'var(--font-sans)' }}>{point.notes}</p>
          </section>
        )}

        <p className="anim-rise" style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '1.5rem', fontFamily: 'var(--font-sans)', animationDelay: '520ms' }}>
          信息最后更新：{updatedDate}
          {point.verified_at && '  ·  已核验'}
        </p>

        <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
          <a href={`/point/${point.id}/report`} style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
            信息有误？点此上报
          </a>
        </div>
      </main>
    </div>
  );
}
