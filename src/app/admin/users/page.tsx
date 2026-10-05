'use client';

import { useCallback, useState } from 'react';
import { useAdmin, useIsSuperAdmin } from '../admin-context';
import { EmptyRow, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import type { AdminRole, AdminUser, ApiResponse } from '@/lib/types';
import { ADMIN_ROLES, ADMIN_ROLE_LABELS } from '@/lib/types';
import { api, ACTION_ERR } from '@/lib/api-client';

const BLANK = () => ({ username: '', password: '', role: 'inspector' as AdminRole, display_name: '' });

export default function AdminUsersPage() {
  const me = useAdmin();
  const isSuper = useIsSuperAdmin();
  const [forbidden, setForbidden] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPwd, setResetPwd] = useState('');

  const fetchUsers = useCallback(async (): Promise<ListResp<AdminUser>> => {
    // 403 要渲染"权限不足"专属空态而非报错，故这一处保留裸 fetch 读 HTTP 状态码
    const r = await fetch('/api/admin/users');
    if (r.status === 403) { setForbidden(true); return { ok: true, data: [] }; }
    const j = await r.json() as ApiResponse<AdminUser[]>;
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data };
  }, []);

  const { items, loading, error, reload } = useAdminList(fetchUsers);

  function closeForm() {
    setShowForm(false);
    setForm(BLANK());
    setFormError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    const j = await api('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (j.ok) { closeForm(); reload(); }
    else setFormError(j.error ?? '创建失败');
  }

  // 重置密码用 type=password 的弹窗（window.prompt 明文可见，且无法粘贴密码管理器的强密码）
  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    if (resetPwd.length < 6) { alert('密码至少 6 位'); return; }
    setSaving(true);
    const j = await api(`/api/admin/users/${resetUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: resetPwd }),
    });
    setSaving(false);
    if (j.ok) { setResetUser(null); setResetPwd(''); alert('密码已重置'); }
    else alert(j.error ?? ACTION_ERR);
  }

  async function changeRole(u: AdminUser, role: AdminRole) {
    const j = await api(`/api/admin/users/${u.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (j.ok) reload();
    else alert(j.error ?? ACTION_ERR);
  }

  async function remove(u: AdminUser) {
    if (!window.confirm(`确定删除账号「${u.username}」？此操作不可恢复。`)) return;
    const j = await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    if (j.ok) reload();
    else alert(j.error ?? '删除失败');
  }

  if (forbidden) return (
    <div className="empty-block">
      <h1 style={{ fontSize: '1.1rem', margin: 0 }}>权限不足</h1>
      <p style={{ fontSize: '0.88rem', marginBottom: 0 }}>账号管理仅对超级管理员开放。</p>
    </div>
  );

  return (
    <>
      {!isSuper && (
        <p className="field-error" style={{ fontFamily: 'var(--font-sans)' }}>
          ※ 账号管理仅对超级管理员开放，如需变更请联系管理员。
        </p>
      )}
      <div className="page-head">
        <h1 className="page-title">账号管理</h1>
        {isSuper && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ 新建账号</button>}
      </div>

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['用户名', '显示名', '角色', '最近登录', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={5} /> : items.length === 0 ? <EmptyRow cols={5} text="暂无账号" /> :
              items.map(u => (
                <tr key={u.id}>
                  <td className="td-name">
                    {u.username}{u.id === me?.id && <span className="td-faint-xs">（我）</span>}
                  </td>
                  <td className="td-muted">{u.display_name || '—'}</td>
                  <td>
                    <select
                      className="select"
                      value={u.role}
                      onChange={e => changeRole(u, e.target.value as AdminRole)}
                      disabled={u.id === me?.id}
                      style={{ width: 'auto', fontSize: '0.82rem', padding: '0.2rem 0.5rem' }}
                      aria-label={`${u.username} 的角色`}
                    >
                      {ADMIN_ROLES.map(r => <option key={r} value={r}>{ADMIN_ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="td-time">
                    {u.last_login_at ? new Date(u.last_login_at * 1000).toLocaleDateString('zh-CN') : '从未登录'}
                  </td>
                  <td className="td-nowrap">
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
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">新建账号</h2>
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="u-name">用户名 *</label>
                <input id="u-name" className="input" value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="字母、数字、下划线" required />
              </div>
              <div className="field">
                <label htmlFor="u-pwd">初始密码 *（至少 6 位）</label>
                <input id="u-pwd" className="input" type="password" value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
              </div>
              <div className="field">
                <label htmlFor="u-display">显示名</label>
                <input id="u-display" className="input" value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="可选" />
              </div>
              <div className="field-lg">
                <label htmlFor="u-role">角色</label>
                <select id="u-role" className="select" value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as AdminRole }))}>
                  {ADMIN_ROLES.map(r => <option key={r} value={r}>{ADMIN_ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              {formError && <p className="field-error form-error" role="alert">⚠ {formError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeForm}>取消</button>
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
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">为 {resetUser.username} 设置新密码</h2>
            <form onSubmit={submitReset} noValidate>
              <div className="field-lg">
                <label htmlFor="r-pwd">新密码（至少 6 位）</label>
                <input id="r-pwd" className="input" type="password" autoComplete="new-password"
                  value={resetPwd} onChange={e => setResetPwd(e.target.value)} required autoFocus />
              </div>
              <div className="modal-actions">
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
