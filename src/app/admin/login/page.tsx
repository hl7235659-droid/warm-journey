'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/admin/me').then(r => {
      if (r.ok) router.replace('/admin/points');
      else setChecking(false);
    }).catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError('请填写用户名和密码'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) { setError(json.error ?? '用户名或密码错误'); return; }
      router.replace('/admin/points');
    } catch { setError('网络异常，请稍后重试'); }
    finally { setLoading(false); }
  }

  if (checking) return null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '1rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: '360px' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>🧡</p>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>暖途同行管理端</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>请登录您的管理账号</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="username">用户名</label>
            <input
              id="username" className="input" type="text" autoComplete="username"
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="admin" autoFocus required
            />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="password">密码</label>
            <input
              id="password" className="input" type="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
            />
          </div>
          {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>⚠ {error}</p>}
          <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
