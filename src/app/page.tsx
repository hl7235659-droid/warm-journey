'use client';
export const runtime = 'edge';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ServicePoint } from '@/lib/types';
import { STATUS_LABELS, SERVICE_TAGS } from '@/lib/types';
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

function PointCard({ point, userLat, userLng, idx, fav, onToggleFav }: {
  point: ServicePoint; userLat: number | null; userLng: number | null; idx: number;
  fav: boolean; onToggleFav: (id: string) => void;
}) {
  const dist = (userLat && userLng) ? haversine(userLat, userLng, point.lat, point.lng) : null;
  const cover = POINT_COVERS[point.id] ?? COVER_FALLBACK;
  const isPhoto = POINT_COVERS[point.id] !== undefined;
  const delay = Math.min(idx, 6) * 70;

  return (
    <a href={`/point/${point.id}`} className="card point-card reveal"
       style={{ animationDelay: `${delay}ms`, position: 'relative' }}
       aria-label={`${point.name}，${STATUS_LABELS[point.status]}`}>
      <button
        type="button"
        aria-label={fav ? '取消收藏' : '收藏该站点'}
        aria-pressed={fav}
        onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleFav(point.id); }}
        style={{
          position: 'absolute', top: '0.5rem', right: '0.5rem', zIndex: 2,
          width: '34px', height: '34px', borderRadius: '50%', border: '1px solid var(--border)',
          background: 'oklch(from var(--surface) l c h / .88)', cursor: 'pointer',
          fontSize: '1rem', lineHeight: 1, color: fav ? 'var(--red-800)' : 'var(--text-faint)',
        }}
      >{fav ? '♥' : '♡'}</button>
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

const FAVS_KEY = 'wj_favs';

export default function HomePage() {
  const [points, setPoints] = useState<ServicePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [geoError, setGeoError] = useState('');
  const [total, setTotal] = useState(0);
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);
  const [cityFilter, setCityFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [favs, setFavs] = useState<string[]>([]);
  const [favOnly, setFavOnly] = useState(false);

  // 已开通城市
  useEffect(() => {
    fetch('/api/cities')
      .then(r => r.json() as Promise<{ ok: boolean; data?: { id: string; name: string }[] }>)
      .then(j => { if (j.ok && j.data) setCities(j.data); })
      .catch(() => { /* 城市列表失败不阻塞主流程 */ });
  }, []);

  // URL 参数初值（AI filter action 落点：/?city=广州&service=充电）
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const city = sp.get('city');
      const service = sp.get('service');
      if (city) setCityFilter(city);
      if (service) setServiceFilter(service);
    } catch { /* ignore */ }
  }, []);

  // 收藏（localStorage）
  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]') as string[];
      setFavs(list);
    } catch { /* ignore */ }
  }, []);

  function toggleFav(id: string) {
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem(FAVS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const fetchPoints = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (statusFilter) params.set('status', statusFilter);
      if (cityFilter) params.set('city', cityFilter);
      if (serviceFilter) params.set('service', serviceFilter);
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
  }, [q, statusFilter, cityFilter, serviceFilter, userLat, userLng]);

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

  const visiblePoints = favOnly ? points.filter(p => favs.includes(p.id)) : points;

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
          {cities.length > 1 && (
            <div className="panel-row">
              <span className="brush-label">城市</span>
              <div className="toolbar-chips" role="group" aria-label="城市筛选">
                <button
                  onClick={() => setCityFilter('')}
                  className={`tab${cityFilter === '' ? ' is-active' : ''}`}
                  aria-pressed={cityFilter === ''}
                >全部</button>
                {cities.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCityFilter(c.name)}
                    className={`tab${cityFilter === c.name ? ' is-active' : ''}`}
                    aria-pressed={cityFilter === c.name}
                  >{c.name}</button>
                ))}
              </div>
            </div>
          )}
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
              <button
                onClick={() => setFavOnly(v => !v)}
                className={`tab${favOnly ? ' is-active' : ''}`}
                aria-pressed={favOnly}
              >♥ 已收藏</button>
            </div>
          </div>
          <div className="panel-row">
            <span className="brush-label">服务</span>
            <div className="toolbar-chips" role="group" aria-label="服务筛选">
              <button
                onClick={() => setServiceFilter('')}
                className={`tab${serviceFilter === '' ? ' is-active' : ''}`}
                aria-pressed={serviceFilter === ''}
              >全部</button>
              {SERVICE_TAGS.map(s => (
                <button
                  key={s}
                  onClick={() => setServiceFilter(cur => (cur === s ? '' : s))}
                  className={`tab${serviceFilter === s ? ' is-active' : ''}`}
                  aria-pressed={serviceFilter === s}
                >{s}</button>
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
        ) : visiblePoints.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 0, margin: 0 }}>
              <span className="seal seal-ink" style={{ fontSize: '0.95rem', padding: '0.5rem 1.1rem' }}>暂 无 结 果</span>
            </p>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', marginTop: '0.75rem' }}>
              {favOnly ? '还没有收藏任何站点，点卡片右上角 ♡ 收藏' : '没有找到符合条件的服务点'}
            </p>
          </div>
        ) : (
          <div className="stack">
            {visiblePoints.map((p, i) => (
              <PointCard key={p.id} point={p} userLat={userLat} userLng={userLng} idx={i}
                fav={favs.includes(p.id)} onToggleFav={toggleFav} />
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
        <a href="/report-status" style={{ color: 'var(--gold-300)', fontSize: '0.82rem', fontFamily: 'var(--font-sans)' }}>
          上报进度查询
        </a>
      </footer>
    </div>
  );
}
