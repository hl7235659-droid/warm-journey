'use client';
export const runtime = 'edge';

import { useEffect, useRef, useState } from 'react';

// ============================================================
// 腾讯位置服务密钥（前端可见，请配置 Referer 白名单防盗用）
// 申请入口：https://lbs.qq.com/dev/console/key/add （腾讯位置服务开放平台 → 应用管理 → 创建应用 → 添加 Key，勾选 WebServiceAPI / JavaScript API GL）
// 拿到 key 后替换下方占位符即可。
// ============================================================
const TMAP_KEY = '请前往腾讯位置服务开放平台申请密钥并替换此占位符';
const KEY_PLACEHOLDER = TMAP_KEY.startsWith('请前往');

interface HeatPoint { id: string; name: string; lat: number; lng: number; status: string; report_count: number }
declare global { interface Window { TMap?: any } }

export default function AdminHeatmapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [points, setPoints] = useState<HeatPoint[]>([]);

  useEffect(() => {
    if (KEY_PLACEHOLDER) { setStatus('error'); return; }
    let cancelled = false;

    async function boot() {
      const [heatJson, cityJson] = await Promise.all([
        fetch('/api/admin/heatmap').then(r => r.json() as Promise<{ ok: boolean; data?: HeatPoint[] }>),
        fetch('/api/cities')
          .then(r => r.json() as Promise<{ ok: boolean; data?: { center_lat: number; center_lng: number }[] }>)
          .catch((): { ok: boolean; data?: { center_lat: number; center_lng: number }[] } => ({ ok: false })),
      ]);
      const data = heatJson.ok && heatJson.data ? heatJson.data : [];
      if (cancelled) return;
      setPoints(data);

      if (!window.TMap) {
        const ok = await new Promise<boolean>(resolve => {
          const s = document.createElement('script');
          s.src = `https://map.qq.com/api/gljs?v=1.exp&libraries=visualization&key=${TMAP_KEY}`;
          s.onload = () => resolve(true);
          s.onerror = () => resolve(false);
          document.head.appendChild(s);
        });
        if (!ok || cancelled) { if (!cancelled) setStatus('error'); return; }
      }
      if (!window.TMap || !mapRef.current) { setStatus('error'); return; }

      const firstCity = cityJson.ok ? cityJson.data?.[0] : undefined;
      const center = firstCity ?? { center_lat: 23.0525, center_lng: 113.385 };
      const map = new window.TMap.Map(mapRef.current, {
        center: new window.TMap.LatLng(center.center_lat, center.center_lng),
        zoom: 13,
      });

      // 热力层：权重 = 近 90 天上报数（无上报也给 1，保证点位可见）
      const heatData = data.map(p => ({ lat: p.lat, lng: p.lng, count: Math.max(p.report_count, 1) }));
      const maxCount = Math.max(...heatData.map(d => d.count), 3);
      new window.TMap.visualization.Heat({
        maxRadius: 40,
        minRadius: 10,
        maxValue: maxCount,
        minValue: 0,
      }).addTo(map).setData(heatData);

      // 点位标记
      new window.TMap.MultiMarker({
        map,
        styles: {
          default: new window.TMap.MarkerStyle({
            width: 22, height: 30, anchor: { x: 11, y: 30 },
            src: 'data:image/svg+xml,' + encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M11 0C4.9 0 0 4.9 0 11c0 8 11 19 11 19s11-11 11-19C22 4.9 17.1 0 11 0z" fill="#8C1F28"/><circle cx="11" cy="11" r="4.5" fill="#F5EEDF"/></svg>',
            ),
          }),
        },
        geometries: data.map(p => ({
          id: p.id,
          styleId: 'default',
          position: new window.TMap.LatLng(p.lat, p.lng),
          properties: { title: `${p.name}（近90天上报 ${p.report_count} 条）` },
        })),
      });

      setStatus('ready');
    }

    void boot();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>上报热力图</h1>
        <p style={{ margin: '0.375rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          颜色越暖 = 近 90 天异常上报越集中，可用于论证「哪里最缺服务、哪里信息最差」。
        </p>
      </div>

      {KEY_PLACEHOLDER ? (
        <div className="card" style={{ padding: '1.5rem', fontSize: '0.9rem', lineHeight: 1.8 }}>
          <strong>需要先配置腾讯位置服务密钥：</strong>
          <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            <li>打开 <a href="https://lbs.qq.com/dev/console/key/add" target="_blank" rel="noreferrer">腾讯位置服务开放平台</a>，创建应用并添加 Key（勾选 JavaScript API GL）。</li>
            <li>把 Key 替换 <code>src/app/admin/heatmap/page.tsx</code> 顶部的 <code>TMAP_KEY</code> 占位符。</li>
            <li>建议在控制台为该 Key 配置 Referer 白名单，防止被盗用。</li>
          </ol>
        </div>
      ) : (
        <div
          ref={mapRef}
          style={{ width: '100%', height: '70vh', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}
          aria-label="服务点上报热力图"
        >
          {status === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              地图加载中…
            </div>
          )}
          {status === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--danger)' }}>
              地图加载失败，请检查密钥配置与网络。
            </div>
          )}
        </div>
      )}

      {points.length > 0 && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-faint)' }}>
          共 {points.length} 个服务点；权重为近 90 天异常上报条数。
        </p>
      )}
    </>
  );
}
