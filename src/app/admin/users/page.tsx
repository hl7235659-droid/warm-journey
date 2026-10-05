'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../admin-context';
import type { AdminUser, AdminRole } from '@/lib/types';

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员', admin: '管理员', inspector: '巡检员',
};

export default function AdminUsersPage() {
  const me = useAdmin();
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'inspector' as AdminRole, display_name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPwd, setResetPwd] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/users');
      if (r.status === 403) { setForbidden(true); return; }
      const j = await r.json() as { ok: boolean; data?: AdminUser[] };
      if (j.ok && j.data) setItems(j.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json() as { ok: boolean; error?: string };
      if (j.ok) { setShowForm(false); setForm({ username: '', password: '', role: 'inspector', display_name: '' }); void load(); }
      else setError(j.error ?? '创建失败');
    } finally { setSaving(false); }
  }

  // 重置密码用 type=password 的弹窗（window.prompt 明文可见，且无法粘贴密码管理器的强密码）
  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    if (resetPwd.length < 6) { alert('密码至少 6 位'); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/users/${resetUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPwd }),
      });
      const j = await r.json() as { ok: boolean; error?: string };
      if (j.ok) { setResetUser(null); setResetPwd(''); alert('密码已重置'); }
      else alert(j.error ?? '操作失败');
    } catch { alert('网络异常，请稍后重试'); }
    finally { setSaving(false); }
  }

  async function changeRole(u: AdminUser, role: AdminRole) {
    const r = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    const j = await r.json() as { ok: boolean; error?: string };
    if (j.ok) void load();
    else alert(j.error ?? '操作失败');
  }

  async function remove(u: AdminUser) {
    if (!window.confirm(`确定删除账号「${u.username}」？此操作不可恢复。`)) return;
    const r = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    const j = await r.json() as { ok: boolean; error?: string };
    if (j.ok) void load();
    else alert(j.error ?? '删除失败');
  }

  if (forbidden) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
      <h1 style={{ fontSize: '1.1rem' }}>权限不足</h1>
      <p style={{ fontSize: '0.88rem' }}>账号管理仅对超级管理员开放。</p>
    </div>
  );

  return (
    <>
      {me?.role !== 'super_admin' && (
        <p className="field-error" style={{ fontFamily: 'var(--font-sans)' }}>
          ※ 账号管理仅对超级管理员开放，如需变更请联系管理员。
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>账号管理</h1>
        {me?.role === 'super_admin' && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ 新建账号</button>
        )}
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['用户名', '显示名', '角色', '最近登录', '操作'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [1,2].map(i => (
              <tr key={i}>{[1,2,3,4,5].map(j => (
                <td key={j} style={{ padding: '0.75rem' }}><div className="skeleton" style={{ height: '16px', borderRadius: '4px' }} /></td>
              ))}</tr>
            )) : items.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500 }}>
                  {u.username}{u.id === me?.id && <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>（我）</span>}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)' }}>{u.display_name || '—'}</td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <select
                    className="select"
                    value={u.role}
                    onChange={e => changeRole(u, e.target.value as AdminRole)}
                    disabled={u.id === me?.id}
                    style={{ width: 'auto', fontSize: '0.82rem', padding: '0.2rem 0.5rem' }}
                    aria-label={`${u.username} 的角色`}
                  >
                    {(['super_admin', 'admin', 'inspector'] as const).map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  {u.last_login_at ? new Date(u.last_login_at * 1000).toLocaleDateString('zh-CN') : '从未登录'}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setResetUser(u); setResetPwd(''); }}>重置密码</button>
                  {u.id !== me?.id && (
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(u)} style={{ color: 'var(--danger)' }}>删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>新建账号</h2>
            <form onSubmit={submit} noValidate>              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="u-name">用户名 *</label>
                <input id="u-name" className="input" value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="字母、数字、下划线" required />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="u-pwd">初始密码 *（至少 6 位）</label>
                <input id="u-pwd" className="input" type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="u-display">显示名</label>
                <input id="u-display" className="input" value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="可选" />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="u-role">角色</label>
                <select id="u-role" className="select" value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as AdminRole }))}>
                  <option value="inspector">巡检员</option>
                  <option value="admin">管理员</option>
                  <option value="super_admin">超级管理员</option>
                </select>
              </div>
              {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>⚠ {error}</p>}
              <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '创建中…' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {resetUser && (
        <div className="modal-backdrop" onClick={() => setResetUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>为 {resetUser.username} 设置新密码</h2>
            <form onSubmit={submitReset} noValidate>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="r-pwd">新密码（至少 6 位）</label>
                <input id="r-pwd" className="input" type="password" autoComplete="new-password"
                  value={resetPwd} onChange={e => setResetPwd(e.target.value)} required autoFocus />
              </div>
              <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setResetUser(null)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
