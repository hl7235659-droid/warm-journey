'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { type Admin, AdminCtx } from './admin-context';
import { api } from '@/lib/api-client';
import { readItem, writeItem } from '@/lib/local';

// roles 与后端 withAdmin 的角色白名单保持一致：入口不给看不到的人（点了才吃 403 是坏体验）
type NavItem = { href: string; label: string; icon: string; exact?: boolean; roles?: string[] };
const NAV: NavItem[] = [
  { href: '/admin',             label: '看板',     icon: '📊', exact: true },
  { href: '/admin/points',      label: '服务点',   icon: '📍' },
  { href: '/admin/reports',     label: '上报',     icon: '🚩' },
  { href: '/admin/work-orders', label: '工单',     icon: '📋' },
  { href: '/admin/inspections', label: '巡检',     icon: '🔍' },
  { href: '/admin/visits',      label: '在店',     icon: '👥' },
  { href: '/admin/knowledge',   label: '知识库',   icon: '📚', roles: ['super_admin', 'admin'] },
  { href: '/admin/heatmap',     label: '热力图',   icon: '🗺️' },
  { href: '/admin/cities',      label: '城市',     icon: '🏙️', roles: ['super_admin', 'admin'] },
  { href: '/admin/users',       label: '账号',     icon: '👤', roles: ['super_admin'] },
];

const COLLAPSE_KEY = 'wj_admin_sidebar_collapsed';
const MOBILE_QUERY = '(max-width: 900px)';

function isMobile() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  // Desktop: 侧边栏是否收成图标条；Mobile: 抽屉是否打开
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (pathname === '/admin/login') { setReady(true); return; }
    void api<Admin>('/api/admin/me').then(j => {
      if (j.ok) setAdmin(j.data);
      else router.replace('/admin/login');
    }).finally(() => setReady(true));
  }, [pathname, router]);

  // 恢复桌面端折叠偏好
  useEffect(() => { setCollapsed(readItem(COLLAPSE_KEY) === '1'); }, []);

  // 切换路由时关闭移动端抽屉
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Esc 关闭抽屉
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggleNav = useCallback(() => {
    if (isMobile()) {
      setDrawerOpen(v => !v);
      return;
    }
    setCollapsed(v => {
      const next = !v;
      writeItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  async function logout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.replace('/admin/login');
  }

  if (!ready) return null;
  if (pathname === '/admin/login') return <>{children}</>;

  const navToggleLabel = isMobile()
    ? (drawerOpen ? '关闭菜单' : '打开菜单')
    : (collapsed ? '展开侧边栏' : '收起侧边栏');

  return (
    <AdminCtx.Provider value={admin}>
      <div className="admin-shell">
        {/* Top bar */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          height: '52px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem',
        }}>
          <button
            type="button"
            className="admin-icon-btn admin-drawer-btn"
            onClick={toggleNav}
            aria-label="打开菜单"
            aria-expanded={drawerOpen}
            aria-controls="admin-sidebar"
          >☰</button>

          <button
            type="button"
            className="admin-icon-btn admin-collapse-btn"
            onClick={toggleNav}
            aria-label={navToggleLabel}
            title={navToggleLabel}
            aria-expanded={!collapsed}
            aria-controls="admin-sidebar"
          >{collapsed ? '»' : '«'}</button>

          <span style={{ fontSize: '1.1rem' }}>🧡</span>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            暖途同行 · 管理端
          </span>
          {admin && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>{admin.username}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ fontSize: '0.8rem', flexShrink: 0 }}>退出</button>
        </header>

        <div className="admin-body">
          {/* Sidebar */}
          <nav
            id="admin-sidebar"
            className={[
              'admin-sidebar',
              collapsed ? 'is-collapsed' : '',
              drawerOpen ? 'is-open' : '',
            ].filter(Boolean).join(' ')}
            aria-label="管理端导航"
          >
            {NAV.filter(n => !n.roles || (admin !== null && n.roles.includes(admin.role))).map(n => {
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              return (
                <a
                  key={n.href} href={n.href}
                  className={`admin-nav-item${active ? ' is-active' : ''}`}
                  title={collapsed && !isMobile() ? n.label : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="admin-nav-icon" aria-hidden="true">{n.icon}</span>
                  <span className="admin-nav-label">{n.label}</span>
                </a>
              );
            })}
          </nav>

          {drawerOpen && (
            <div className="admin-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          )}

          {/* Main content */}
          <main className="admin-main">
            {children}
          </main>
        </div>
      </div>
    </AdminCtx.Provider>
  );
}
