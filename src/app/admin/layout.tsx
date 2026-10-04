'use client';
export const runtime = 'edge';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { type Admin, AdminCtx } from './admin-context';

const NAV = [
  { href: '/admin/points',      label: '服务点',   icon: '📍' },
  { href: '/admin/reports',     label: '上报',     icon: '🚩' },
  { href: '/admin/work-orders', label: '工单',     icon: '📋' },
  { href: '/admin/inspections', label: '巡检',     icon: '🔍' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (pathname === '/admin/login') { setReady(true); return; }
    fetch('/api/admin/me').then(async r => {
      if (!r.ok) { router.replace('/admin/login'); return; }
      const j = await r.json() as { ok: boolean; data: Admin };
      if (j.ok) setAdmin(j.data);
      else router.replace('/admin/login');
    }).catch(() => router.replace('/admin/login')).finally(() => setReady(true));
  }, [pathname, router]);

  async function logout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.replace('/admin/login');
  }

  if (!ready) return null;
  if (pathname === '/admin/login') return <>{children}</>;

  return (
    <AdminCtx.Provider value={admin}>
      <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column' }}>
        {/* Top bar */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          height: '52px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.1rem' }}>🧡</span>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>暖途同行 · 管理端</span>
          {admin && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{admin.username}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ fontSize: '0.8rem' }}>退出</button>
        </header>

        <div style={{ display: 'flex', flex: 1 }}>
          {/* Sidebar */}
          <nav style={{
            width: '180px', flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            padding: '0.75rem 0.5rem',
            display: 'flex', flexDirection: 'column', gap: '2px',
          }}>
            {NAV.map(n => {
              const active = pathname.startsWith(n.href);
              return (
                <a
                  key={n.href} href={n.href}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.5rem 0.75rem', borderRadius: 'var(--r-md)',
                    textDecoration: 'none', fontSize: '0.875rem', fontWeight: active ? 600 : 400,
                    background: active ? 'oklch(from var(--accent) l c h / .1)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-body)',
                  }}
                  aria-current={active ? 'page' : undefined}
                >
                  <span>{n.icon}</span>{n.label}
                </a>
              );
            })}
          </nav>

          {/* Main content */}
          <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: 'var(--bg)' }}>
            {children}
          </main>
        </div>
      </div>
    </AdminCtx.Provider>
  );
}
