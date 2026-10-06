'use client';

import { useState, useEffect, useRef } from 'react';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS, STATUS_SEALS } from '@/lib/types';
import { POINT_COVERS, COVER_FALLBACK } from '@/lib/covers';
import { Corners } from '@/components/ornaments';
import type { PointSignals, Occupancy } from '@/lib/db';
import { navToPoint } from '@/lib/nav';
import { getRiderToken } from '@/lib/rider';
import { api } from '@/lib/api-client';
import { formatCNDate } from '@/lib/format';
import { LS_KEYS, readItem, writeItem } from '@/lib/local';
import VisitCard from './VisitCard';

interface Props { point: ServicePoint; signals: PointSignals; occupancy: Occupancy }

export default function PointDetailClient({ point, signals, occupancy }: Props) {
  const [copied, setCopied] = useState(false);
  const [confirmCount, setConfirmCount] = useState(signals.confirm_count);
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusClass = STATUS_SEALS[point.status];
  const updatedDate = formatCNDate(point.updated_at, { year: 'numeric', month: 'long', day: 'numeric' });
  const cover = POINT_COVERS[point.id] ?? COVER_FALLBACK;
  const isPhoto = POINT_COVERS[point.id] !== undefined;

  const CONFIRM_KEY = LS_KEYS.confirmed(point.id);

  // 本机已确认过则置灰，避免重复计数
  useEffect(() => { if (readItem(CONFIRM_KEY)) setConfirmed(true); }, [CONFIRM_KEY]);

  async function handleConfirm() {
    if (confirmed || confirming) return;
    setConfirming(true);
    const json = await api<{ confirm_count: number }>(`/api/points/${point.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rider_token: getRiderToken() }),
    });
    if (json.ok) {
      setConfirmCount(json.data.confirm_count);
      setConfirmed(true);
      writeItem(CONFIRM_KEY, '1');
    } else if (json.error) {
      setConfirmError(json.error);
    }
    setConfirming(false);
  }

  // 卸载时清理"已复制"提示的定时器
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  function copyAddress() {
    navigator.clipboard.writeText(point.address).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
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
          <img src={cover} alt={isPhoto ? `${point.name} 实景` : `${point.name} 插画示意`} width={800} height={450} />
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
          <button
            type="button"
            className="btn btn-secondary btn-lg"
            style={{ flexShrink: 0 }}
            onClick={() => window.dispatchEvent(new CustomEvent('wj-ai-open', { detail: { pointId: point.id } }))}
            aria-label="问小暖 AI 助手"
          >
            问小暖
          </button>
        </div>

        {/* 预约进店 + 在店人数 */}
        <VisitCard pointId={point.id} pointStatus={point.status} initialOccupancy={occupancy} />

        {/* Services — 素读点分隔 */}
        {point.services.length > 0 && (
          <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '340ms' }}>
            <h2 className="sub-title">
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

        {/* 实时信号：还能用吗 */}
        <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '380ms' }}>
          <h2 className="sub-title">
            站点近况
          </h2>
          <div className="stack-sm">
            {signals.pending_reports_30d > 0 ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="seal seal-gold" aria-hidden="true">警</span>
                <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
                  近 30 天有 <strong>{signals.pending_reports_30d}</strong> 条异常上报待核实，前往前请留意
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="seal seal-jade" aria-hidden="true">安</span>
                <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>近 30 天无待核实异常上报</span>
              </div>
            )}
            {signals.last_inspection && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="mi-seal" aria-hidden="true"><i>检</i></span>
                <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
                  最近巡检：{{ pass: '通过', fail: '未通过', partial: '部分通过' }[signals.last_inspection.result] ?? signals.last_inspection.result}
                  （{formatCNDate(signals.last_inspection.inspected_at)}）
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)', color: 'var(--text-muted)' }}>
                {confirmCount > 0 ? `${confirmCount} 位骑手确认信息无误` : '还没有骑手确认过，等你来确认'}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleConfirm}
                disabled={confirmed || confirming}
                aria-pressed={confirmed}
              >
                {confirmed ? '已确认 ✓' : confirming ? '提交中…' : '信息无误'}
              </button>
            </div>
            {confirmError && (
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.82rem', color: 'var(--danger)', fontFamily: 'var(--font-sans)' }}>
                {confirmError}
              </p>
            )}
          </div>
        </section>

        {/* Admission */}
        {(point.admission.id_required || point.admission.capacity || point.admission.notes) && (
          <section className="card anim-rise" style={{ marginBottom: '1rem', animationDelay: '400ms' }}>
            <h2 className="sub-title">
              准入要求
            </h2>
            <div className="stack-sm">
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="mi-seal" aria-hidden="true"><i>骑</i></span>
                <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
                  所有骑手均可进入
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
            <h2 className="sub-title">
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
