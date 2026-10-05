'use client';

import { useState, useEffect } from 'react';
import { useAdmin } from './admin-context';
import type { AdminStats } from '@/lib/db';
import { api } from '@/lib/api-client';

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员', admin: '管理员', inspector: '巡检员',
};

export default function AdminDashboard() {
  const admin = useAdmin();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<AdminStats>('/api/admin/stats').then(j => {
      if (j.ok && j.data) setStats(j.data);
      setLoading(false);
    });
  }, []);

  const cards: { label: string; value: number | undefined; href: string; tone?: 'warn' | 'ok' }[] = [
    { label: '服务点总数',     value: stats?.points_total,      href: '/admin/points' },
    { label: '开放中',         value: stats?.points_open,       href: '/admin/points', tone: 'ok' },
    { label: '待核实上报',     value: stats?.reports_pending,   href: '/admin/reports', tone: 'warn' },
    { label: '核实处理中',     value: stats?.reports_processing, href: '/admin/reports' },
    { label: '待处理工单',     value: stats?.orders_open,       href: '/admin/work-orders', tone: 'warn' },
    { label: '处理中工单',     value: stats?.orders_in_progress, href: '/admin/work-orders' },
    { label: '近 30 天巡检',   value: stats?.inspections_30d,   href: '/admin/inspections' },
    { label: '当前在店',       value: stats?.in_store_now,      href: '/admin/visits', tone: 'ok' },
    { label: '今日进店',       value: stats?.visits_today,      href: '/admin/visits' },
    { label: '骑手确认累计',   value: stats?.confirms_total,    href: '/admin/points', tone: 'ok' },
    { label: '离店评分',       value: stats?.avg_rating ?? undefined, href: '/admin/visits', tone: 'ok' },
    { label: '已开通城市',     value: stats?.cities_enabled,    href: '/admin/cities' },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>数据看板</h1>
        {admin && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {admin.username} · {ROLE_LABELS[admin.role] ?? admin.role}
          </span>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '0.75rem',
      }}>
        {cards.map(c => (
          <a key={c.label} href={c.href} className="card" style={{ textDecoration: 'none', color: 'inherit', padding: '1rem' }}>
            <div style={{
              fontSize: '1.75rem', fontWeight: 800, lineHeight: 1.1,
              color: c.tone === 'warn' && (c.value ?? 0) > 0 ? 'var(--danger)'
                   : c.tone === 'ok' ? 'var(--jade, #2f7d5b)' : 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {loading ? '–' : (c.value ?? 0)}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.375rem' }}>{c.label}</div>
          </a>
        ))}
      </div>

      {!loading && stats && (stats.reports_pending > 0 || stats.orders_open > 0) && (
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
          ※ 有 {stats.reports_pending} 条上报待核实、{stats.orders_open} 个工单待处理，建议优先跟进。
        </p>
      )}
    </>
  );
}
