'use client';

import { useCallback, useState } from 'react';
import { useCanWrite } from '../admin-context';
import { EmptyRow, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import type { City } from '@/lib/db';
import { api } from '@/lib/api-client';

const BLANK = () => ({ name: '', center_lat: '', center_lng: '' });

export default function AdminCitiesPage() {
  const canWrite = useCanWrite();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchCities = useCallback(async (): Promise<ListResp<City>> => {
    const j = await api<City[]>('/api/admin/cities');
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data };
  }, []);

  const { items, loading, error, reload } = useAdminList(fetchCities);

  function closeForm() {
    setShowForm(false);
    setForm(BLANK());
    setFormError('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    const j = await api('/api/admin/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        center_lat: parseFloat(form.center_lat) || 0,
        center_lng: parseFloat(form.center_lng) || 0,
      }),
    });
    setSaving(false);
    if (j.ok) { closeForm(); reload(); }
    else setFormError(j.error ?? '创建失败');
  }

  async function toggleEnabled(c: City) {
    const j = await api(`/api/admin/cities/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: c.enabled ? 0 : 1 }),
    });
    if (j.ok) reload();
    else alert(j.error ?? '操作失败');
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">城市管理</h1>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ 开通城市</button>}
      </div>

      <p className="hint">已开通城市会出现在 C 端首页的城市筛选中；视野中心用于地图类功能的默认定位。</p>

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['城市', '视野中心', '状态', '操作'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={4} /> : items.length === 0 ? <EmptyRow cols={4} text="暂无城市" /> :
              items.map(c => (
                <tr key={c.id}>
                  <td className="td-name">{c.name}</td>
                  <td className="td-meta">{c.center_lat.toFixed(4)}, {c.center_lng.toFixed(4)}</td>
                  <td>
                    <span className={`badge ${c.enabled ? 'badge-green' : 'badge-red'}`}>
                      {c.enabled ? '已开通' : '已停用'}
                    </span>
                  </td>
                  <td>
                    {canWrite && (
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleEnabled(c)}>
                        {c.enabled ? '停用' : '开通'}
                      </button>
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
            <h2 className="modal-title">开通城市</h2>
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="c-name">城市名 *</label>
                <input id="c-name" className="input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例：深圳" required />
              </div>
              <div className="field-lg" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
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
    </>
  );
}
