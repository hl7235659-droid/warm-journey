'use client';
export const runtime = 'edge';

import { useState, useEffect, useCallback } from 'react';
import type { City } from '@/lib/db';

export default function AdminCitiesPage() {
  const [items, setItems] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', center_lat: '', center_lng: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/cities');
      const j = await r.json() as { ok: boolean; data?: City[] };
      if (j.ok && j.data) setItems(j.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/admin/cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          center_lat: parseFloat(form.center_lat) || 0,
          center_lng: parseFloat(form.center_lng) || 0,
        }),
      });
      const j = await r.json() as { ok: boolean; error?: string };
      if (j.ok) { setShowForm(false); setForm({ name: '', center_lat: '', center_lng: '' }); void load(); }
      else setError(j.error ?? '创建失败');
    } finally { setSaving(false); }
  }

  async function toggleEnabled(c: City) {
    const r = await fetch(`/api/admin/cities/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: c.enabled ? 0 : 1 }),
    });
    const j = await r.json() as { ok: boolean; error?: string };
    if (j.ok) void load();
    else alert(j.error ?? '操作失败');
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>城市管理</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ 开通城市</button>
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        已开通城市会出现在 C 端首页的城市筛选中；视野中心用于地图类功能的默认定位。
      </p>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['城市', '视野中心', '状态', '操作'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [1,2].map(i => (
              <tr key={i}>{[1,2,3,4].map(j => (
                <td key={j} style={{ padding: '0.75rem' }}><div className="skeleton" style={{ height: '16px', borderRadius: '4px' }} /></td>
              ))}</tr>
            )) : items.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无城市</td></tr>
            ) : items.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  {c.center_lat.toFixed(4)}, {c.center_lng.toFixed(4)}
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${c.enabled ? 'badge-green' : 'badge-red'}`}>
                    {c.enabled ? '已开通' : '已停用'}
                  </span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleEnabled(c)}>
                    {c.enabled ? '停用' : '开通'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>开通城市</h2>
            <form onSubmit={submit} noValidate>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="c-name">城市名 *</label>
                <input id="c-name" className="input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例：深圳" required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '1.25rem' }}>
                <div>
                  <label htmlFor="c-lat">中心纬度</label>
                  <input id="c-lat" className="input" type="number" step="0.0001" value={form.center_lat}
                    onChange={e => setForm(f => ({ ...f, center_lat: e.target.value }))} placeholder="23.1291" />
                </div>
                <div>
                  <label htmlFor="c-lng">中心经度</label>
                  <input id="c-lng" className="input" type="number" step="0.0001" value={form.center_lng}
                    onChange={e => setForm(f => ({ ...f, center_lng: e.target.value }))} placeholder="113.2644" />
                </div>
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
    </>
  );
}
