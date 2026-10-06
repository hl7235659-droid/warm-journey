'use client';

// 首页检索匣：城市 / 状态（含收藏开关）/ 服务三组 chips + 搜索框与定位按钮。
// 纯展示组件——筛选状态由 HomePage 持有（fetchPoints 依赖全部筛选值，收上来才能触发重查）。
import type { PointStatus } from '@/lib/types';
import { STATUS_LABELS, POINT_STATUSES, SERVICE_TAGS } from '@/lib/types';

// 状态筛选 chips：'全部' + 与后端同一份状态枚举
const STATUS_CHIPS: Array<'' | PointStatus> = ['', ...POINT_STATUSES];

interface FilterPanelProps {
  cities: { id: string; name: string }[];
  city: string;
  onCity: (name: string) => void;
  status: string;
  onStatus: (s: '' | PointStatus) => void;
  favOnly: boolean;
  onToggleFavOnly: () => void;
  service: string;
  onServiceToggle: (s: string) => void;
  q: string;
  onQuery: (v: string) => void;
  onLocate: () => void;
}

export default function FilterPanel({
  cities, city, onCity, status, onStatus, favOnly, onToggleFavOnly,
  service, onServiceToggle, q, onQuery, onLocate,
}: FilterPanelProps) {
  return (
    <div className="panel-frame anim-rise" style={{ animationDelay: '200ms' }}>
      {cities.length > 1 && (
        <div className="panel-row">
          <span className="brush-label">城市</span>
          <div className="toolbar-chips" role="group" aria-label="城市筛选">
            <button
              onClick={() => onCity('')}
              className={`tab${city === '' ? ' is-active' : ''}`}
              aria-pressed={city === ''}
            >全部</button>
            {cities.map(c => (
              <button
                key={c.id}
                onClick={() => onCity(c.name)}
                className={`tab${city === c.name ? ' is-active' : ''}`}
                aria-pressed={city === c.name}
              >{c.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="panel-row">
        <span className="brush-label">筛选</span>
        <div className="toolbar-chips" role="group" aria-label="状态筛选">
          {STATUS_CHIPS.map(s => (
            <button
              key={s}
              onClick={() => onStatus(s)}
              className={`tab${status === s ? ' is-active' : ''}`}
              aria-pressed={status === s}
            >
              {s === '' ? '全部' : STATUS_LABELS[s]}
            </button>
          ))}
          <button
            onClick={onToggleFavOnly}
            className={`tab${favOnly ? ' is-active' : ''}`}
            aria-pressed={favOnly}
          >♥ 已收藏</button>
        </div>
      </div>
      <div className="panel-row">
        <span className="brush-label">服务</span>
        <div className="toolbar-chips" role="group" aria-label="服务筛选">
          <button
            onClick={() => onServiceToggle('')}
            className={`tab${service === '' ? ' is-active' : ''}`}
            aria-pressed={service === ''}
          >全部</button>
          {SERVICE_TAGS.map(s => (
            <button
              key={s}
              onClick={() => onServiceToggle(s)}
              className={`tab${service === s ? ' is-active' : ''}`}
              aria-pressed={service === s}
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
          onChange={e => onQuery(e.target.value)}
          aria-label="搜索站点"
        />
        <button
          className="btn btn-secondary"
          onClick={onLocate}
          aria-label="使用我的位置排序"
          title="按距离排序"
          style={{ flexShrink: 0, padding: '0 0.875rem' }}
        >
          定位
        </button>
      </div>
    </div>
  );
}
