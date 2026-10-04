'use client';
export const runtime = 'edge';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';
import { POINT_COVERS, COVER_FALLBACK } from '@/lib/covers';
import { Branch, Corners, Swoosh } from '@/components/ornaments';


const STATUS_SEALS: Record<ServicePoint['status'], string> = {
  open: 'seal-jade',
  closed: 'seal-ink',
  temp_closed: 'seal-gold',
};

// Simple distance calc (Haversine, km)
function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km: number) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplay(value); return; }
    const t0 = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display}</>;
}

function PointCard({ point, userLat, userLng, idx }: { point: ServicePoint; userLat: number | null; userLng: number | null; idx: number }) {
  const dist = (userLat && userLng) ? haversine(userLat, userLng, point.lat, point.lng) : null;
  const cover = POINT_COVERS[point.id] ?? COVER_FALLBACK;
  const isPhoto = POINT_COVERS[point.id] !== undefined;
  const delay = Math.min(idx, 6) * 70;

  return (
    <a href={`/point/${point.id}`} className="card point-card reveal"
       style={{ animationDelay: `${delay}ms` }}
       aria-label={`${point.name}，${STATUS_LABELS[point.status]}`}>
      <div className="point-cover">
        <img src={cover} alt={isPhoto ? `${point.name} 实景` : `${point.name} 插画示意`} loading="lazy" />
        <span className={`seal ${STATUS_SEALS[point.status]} cover-badge anim-stamp`}
              style={{ animationDelay: `${delay + 250}ms` }}>
          {STATUS_LABELS[point.status]}
        </span>
        {dist !== null && <span className="cover-dist">{formatDist(dist)}</span>}
      </div>
      <div className="point-body">
        <h2 className="point-name">{point.name}</h2>
        <p className="point-meta"><span className="mi-seal" aria-hidden="true"><i>址</i></span>{point.address}</p>
        <p className="point-meta"><span className="mi-seal" aria-hidden="true"><i>时</i></span>{point.open_hours}</p>
        {point.services.length > 0 && (
          <div className="point-tags">
            {point.services.slice(0, 5).map(s => (
              <span key={s} className="tag">{s}</span>
            ))}
            {point.services.length > 5 && (
              <span className="tag" style={{ opacity: 0.75 }}>+{point.services.length - 5}</span>
            )}
          </div>
        )}
      </div>
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

  // 滚动揭示：进入视口的卡片播放入场动画
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal:not(.is-visible)'));
    if (!els.length) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [points, loading]);

  function requestLocation() {
    if (!navigator.geolocation) { setGeoError('浏览器不支持定位'); return; }
    navigator.geolocation.getCurrentPosition(
      p => { setUserLat(p.coords.latitude); setUserLng(p.coords.longitude); },
      () => setGeoError('无法获取位置，请检查权限设置'),
      { timeout: 8000 },
    );
  }

  const stats = useMemo(() => {
    const openCount = points.filter(p => p.status === 'open').length;
    const serviceTypes = new Set(points.flatMap(p => p.services)).size;
    return { openCount, serviceTypes };
  }, [points]);

  return (
    <div className="slide">
      {/* 朱漆红头横幅 */}
      <header className="band">
        <Corners />
        <Branch />
        <div className="band-top anim-rise">
          <span className="brand-mark" aria-hidden="true">
            <img src="/images/logo-mark.png" alt="" />
          </span>
          <span className="band-brandcol">
            <span className="band-brand">暖途同行</span>
            <span className="band-frame">骑手服务点平台</span>
          </span>
          <span style={{ flex: 1 }} />
          <a href="/admin" className="btn btn-ghost btn-sm" style={{ color: 'var(--gold-300)' }}>管理端</a>
        </div>
        <div className="band-cover">
          <div className="anim-rise" style={{ animationDelay: '80ms' }}>
            <span className="band-eyebrow">新就业群体服务 · 公益项目</span>
            <h1 className="band-title">
              <img src="/images/title-calligraphy.png" alt="暖途同行" />
            </h1>
            <Swoosh />
          </div>
          <div className="band-right anim-rise" style={{ animationDelay: '160ms' }}>
            <span className="band-subframe" aria-hidden="true">城市骑手服务点一张网</span>
          </div>
        </div>

        {/* 圆章数据组（红带内） */}
        <div className="hero-stats">
          <div className="stat-seal anim-pop" style={{ animationDelay: '320ms' }}>
            <b>{loading ? '–' : <CountUp value={total} />}</b>
            <span>服务站点</span>
          </div>
          <span className="chev anim-rise" style={{ animationDelay: '420ms' }} aria-hidden="true">❯❯</span>
          <div className="stat-seal anim-pop" style={{ animationDelay: '460ms' }}>
            <b>{loading ? '–' : <CountUp value={stats.openCount} />}</b>
            <span>当前开放</span>
          </div>
          <span className="chev anim-rise" style={{ animationDelay: '560ms' }} aria-hidden="true">❯❯</span>
          <div className="stat-seal anim-pop" style={{ animationDelay: '600ms' }}>
            <b>{loading ? '–' : <CountUp value={stats.serviceTypes} />}</b>
            <span>服务项目</span>
          </div>
        </div>

        <p className="band-slogan anim-rise" style={{ animationDelay: '720ms' }}>
          找得到站、歇得了脚、暖得下心。查位置、查状态、看服务，一扫即达，让每一程都有处可歇。
        </p>
      </header>

      <div className="slide-body">
        {/* 检索匣 */}
        <div className="panel-frame anim-rise" style={{ animationDelay: '200ms' }}>
          <div className="panel-row">
            <span className="brush-label">筛选</span>
            <div className="toolbar-chips" role="group" aria-label="状态筛选">
              {['', 'open', 'closed', 'temp_closed'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`tab${statusFilter === s ? ' is-active' : ''}`}
                  aria-pressed={statusFilter === s}
                >
                  {{ '': '全部', open: '开放中', closed: '已关闭', temp_closed: '临时关闭' }[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-row">
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
              定位
            </button>
          </div>
        </div>

        {geoError && (
          <p style={{ fontSize: '0.83rem', color: 'var(--danger)', margin: '0.75rem 0 0' }}>{geoError}</p>
        )}

        {/* 列表 */}
        <div className="section-head anim-rise">
          <h2>服务站点</h2>
          <small>
            {loading ? '加载中…' : `共 ${total} 个${userLat ? ' · 按距离排序' : ''}`}
          </small>
        </div>

        {loading ? (
          <div className="stack">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ height: '280px', borderRadius: 'var(--r-lg)' }} />
            ))}
          </div>
        ) : points.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 0, margin: 0 }}>
              <span className="seal seal-ink" style={{ fontSize: '0.95rem', padding: '0.5rem 1.1rem' }}>暂 无 结 果</span>
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', marginTop: '0.75rem' }}>
              没有找到符合条件的服务点
            </p>
          </div>
        ) : (
          <div className="stack">
            {points.map((p, i) => (
              <PointCard key={p.id} point={p} userLat={userLat} userLng={userLng} idx={i} />
            ))}
          </div>
        )}
      </div>

      {/* 页脚红带 */}
      <footer className="band-foot">
        <Corners bottom />
        <Branch flip />
        <b>暖途同行</b>
        <span>温暖骑手的每一程旅途</span>
      </footer>
    </div>
  );
}
