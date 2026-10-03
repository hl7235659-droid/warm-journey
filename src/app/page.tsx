'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';

// Simple distance calc (Haversine, km)
function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function StatusDot({ status }: { status: ServicePoint['status'] }) {
  const map = { open: 'bg-green-500', closed: 'bg-red-500', temp_closed: 'bg-amber-400' };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status]}`} aria-hidden="true" />;
}

function PointCard({ point, userLat, userLng }: { point: ServicePoint; userLat: number | null; userLng: number | null }) {
  const dist = (userLat && userLng) ? haversine(userLat, userLng, point.lat, point.lng) : null;
  const badgeClass = { open: 'badge-green', closed: 'badge-red', temp_closed: 'badge-amber' }[point.status];

  return (
    <a
      href={`/point/${point.id}`}
      className="card block"
      style={{ textDecoration: 'none', color: 'inherit' }}
      aria-label={`${point.name}，${STATUS_LABELS[point.status]}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.2rem', marginTop: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {point.name}
          </h2>
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '0 0 0.5rem',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📍 {point.address}
          </p>
          <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: 0 }}>
            🕐 {point.open_hours}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', flexShrink: 0 }}>
          <span className={`badge ${badgeClass}`}>
            <StatusDot status={point.status} />
            {STATUS_LABELS[point.status]}
          </span>
          {dist !== null && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
              {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}
            </span>
          )}
        </div>
      </div>
      {point.services.length > 0 && (
        <div style={{ marginTop: '0.625rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
          {point.services.slice(0, 5).map(s => (
            <span key={s} className="tag">{s}</span>
          ))}
          {point.services.length > 5 && (
            <span className="tag" style={{ color: 'var(--text-faint)' }}>+{point.services.length - 5}</span>
          )}
        </div>
      )}
    </a>
  );
}

export default function HomePage() {
  const [points, setPoints] = useState<ServicePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [geoError, setGeoError] = useState('');
  const [total, setTotal] = useState(0);

  const fetchPoints = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page_size', '50');
      const res = await fetch(`/api/points?${params}`);
      const json = await res.json() as { ok: boolean; data?: { items: ServicePoint[]; total: number } };
      if (json.ok && json.data) {
        let items = json.data.items;
        if (userLat && userLng) {
          items = [...items].sort((a, b) =>
            haversine(userLat, userLng, a.lat, a.lng) - haversine(userLat, userLng, b.lat, b.lng)
          );
        }
        setPoints(items);
        setTotal(json.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, userLat, userLng]);

  useEffect(() => { void fetchPoints(); }, [fetchPoints]);

  function requestLocation() {
    if (!navigator.geolocation) { setGeoError('浏览器不支持定位'); return; }
    navigator.geolocation.getCurrentPosition(
      p => { setUserLat(p.coords.latitude); setUserLng(p.coords.longitude); },
      () => setGeoError('无法获取位置，请检查权限设置'),
      { timeout: 8000 },
    );
  }

  return (
    <>
      {/* Navbar */}
      <nav className="navbar">
        <span style={{ fontSize: '1.2rem' }}>🧡</span>
        <span style={{ fontWeight: 700, fontSize: '1.05rem', flex: 1 }}>暖途同行</span>
        <a href="/admin" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>管理端</a>
      </nav>

      <main className="page" style={{ paddingTop: '1.25rem' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '1rem 0 1.5rem' }}>
          <h1 style={{ marginBottom: '0.4rem' }}>找附近服务站</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            查位置、查状态、看服务项目，一扫即达
          </p>
        </div>

        {/* Search bar */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <input
            className="input"
            type="search"
            placeholder="搜索站点名称或地址…"
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label="搜索站点"
          />
          <button
            className="btn btn-secondary"
            onClick={requestLocation}
            aria-label="使用我的位置排序"
            title="按距离排序"
            style={{ flexShrink: 0, padding: '0 0.875rem' }}
          >
            📍
          </button>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', paddingBottom: '2px' }}
             role="group" aria-label="状态筛选">
          {['', 'open', 'closed', 'temp_closed'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="btn btn-sm"
              style={{
                flexShrink: 0,
                background: statusFilter === s ? 'var(--accent)' : 'var(--surface)',
                color: statusFilter === s ? 'var(--accent-fg)' : 'var(--text-muted)',
                borderColor: statusFilter === s ? 'var(--accent)' : 'var(--border)',
              }}
              aria-pressed={statusFilter === s}
            >
              {{ '': '全部', open: '开放中', closed: '已关闭', temp_closed: '临时关闭' }[s]}
            </button>
          ))}
        </div>

        {geoError && (
          <p style={{ fontSize: '0.83rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>{geoError}</p>
        )}

        {/* Results */}
        {loading ? (
          <div className="stack">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ height: '110px', borderRadius: 'var(--r-lg)' }} />
            ))}
          </div>
        ) : points.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</p>
            <p>没有找到符合条件的服务点</p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)', marginBottom: '0.625rem' }}>
              共 {total} 个服务点{userLat ? '，已按距离排序' : ''}
            </p>
            <div className="stack">
              {points.map(p => (
                <PointCard key={p.id} point={p} userLat={userLat} userLng={userLng} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
