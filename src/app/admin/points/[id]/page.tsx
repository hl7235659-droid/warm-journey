'use client';
export const runtime = 'edge';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ServicePoint } from '@/lib/types';
import { SERVICE_TAGS } from '@/lib/types';

const BLANK = (): Partial<ServicePoint> => ({
  name: '', address: '', lat: 0, lng: 0, city: '', district: '', open_hours: '',
  status: 'open', contact_phone: '', notes: '',
  services: [],
  admission: { id_required: false, capacity: undefined, notes: '' },
});

export default function AdminPointEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const [form, setForm] = useState(BLANK());
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch('/api/admin/cities')
      .then(r => r.json() as Promise<{ ok: boolean; data?: { id: string; name: string }[] }>)
      .then(j => { if (j.ok && j.data) setCities(j.data.filter(c => (c as { enabled?: number }).enabled !== 0)); })
      .catch(() => { /* 城市列表不可用时仍可手填 */ });
  }, []);

  useEffect(() => {
    if (isNew) return;
    fetch(`/api/admin/points/${id}`)
      .then(r => r.json() as Promise<{ ok: boolean; data?: ServicePoint }>)
      .then(j => { if (j.ok && j.data) setForm(j.data); })
      .finally(() => setLoading(false));
  }, [id, isNew]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function setAdmission<K extends keyof NonNullable<typeof form['admission']>>(
    k: K, v: NonNullable<typeof form['admission']>[K],
  ) {
    setForm(f => ({ ...f, admission: { ...f.admission!, [k]: v } }));
  }

  function toggleService(s: string) {
    setForm(f => {
      const cur = f.services ?? [];
      return { ...f, services: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim() || !form.address?.trim()) {
      setError('名称和地址为必填项'); return;
    }
    setSaving(true); setError('');
    try {
      const url = isNew ? '/api/admin/points' : `/api/admin/points/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          lat: Number(form.lat) || 0,
          lng: Number(form.lng) || 0,
        }),
      });
      const j = await res.json() as { ok: boolean; error?: string };
      if (!j.ok) { setError(j.error ?? '保存失败'); return; }
      router.replace('/admin/points');
    } catch { setError('网络异常，请稍后重试'); }
    finally { setSaving(false); }
  }

  if (loading) return (
    <div className="stack" style={{ maxWidth: '640px' }}>
      {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: '56px', borderRadius: 'var(--r-lg)' }} />)}
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => router.back()}>← 返回</button>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>{isNew ? '新增服务点' : '编辑服务点'}</h1>
      </div>

      <form onSubmit={handleSubmit} noValidate style={{ maxWidth: '640px' }}>
        {/* Basic info */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            基本信息
          </h2>
          <div className="stack">
            <div>
              <label htmlFor="name">名称 *</label>
              <input id="name" className="input" required value={form.name ?? ''} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="address">地址 *</label>
              <input id="address" className="input" required value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.625rem' }}>
              <div>
                <label htmlFor="lat">纬度</label>
                <input id="lat" className="input" type="number" step="0.000001"
                  value={form.lat ?? 0} onChange={e => set('lat', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label htmlFor="lng">经度</label>
                <input id="lng" className="input" type="number" step="0.000001"
                  value={form.lng ?? 0} onChange={e => set('lng', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.625rem' }}>
              <div>
                <label htmlFor="city">城市</label>
                <select id="city" className="select" value={form.city ?? ''} onChange={e => set('city', e.target.value)}>
                  <option value="">未指定</option>
                  {cities.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="district">区县</label>
                <input id="district" className="input" placeholder="例：番禺区"
                  value={form.district ?? ''} onChange={e => set('district', e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="open_hours">营业时间</label>
              <input id="open_hours" className="input" placeholder="例：09:00–22:00"
                value={form.open_hours ?? ''} onChange={e => set('open_hours', e.target.value)} />
            </div>
            <div>
              <label htmlFor="contact_phone">联系电话</label>
              <input id="contact_phone" className="input" type="tel"
                value={form.contact_phone ?? ''} onChange={e => set('contact_phone', e.target.value)} />
            </div>
            <div>
              <label htmlFor="status">状态</label>
              <select id="status" className="select" value={form.status ?? 'open'} onChange={e => set('status', e.target.value as ServicePoint['status'])}>
                <option value="open">开放中</option>
                <option value="temp_closed">临时关闭</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <div>
              <label htmlFor="notes">备注</label>
              <textarea id="notes" className="textarea" rows={2}
                value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            服务项目
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {SERVICE_TAGS.map(s => {
              const on = form.services?.includes(s) ?? false;
              return (
                <button
                  key={s} type="button"
                  onClick={() => toggleService(s)}
                  className="btn btn-sm"
                  style={{
                    background: on ? 'var(--accent)' : 'var(--surface)',
                    color: on ? 'var(--accent-fg)' : 'var(--text-muted)',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                  }}
                  aria-pressed={on}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Admission */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            准入要求
          </h2>
          <div className="stack">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
              <input type="checkbox"
                checked={form.admission?.id_required ?? false}
                onChange={e => setAdmission('id_required', e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent)', flexShrink: 0 }}
              />
              <span style={{ fontSize: '0.9rem' }}>需出示骑手工牌 / 接单截图</span>
            </label>
            <div>
              <label htmlFor="capacity">最大容纳人数</label>
              <input id="capacity" className="input" type="number" min="0"
                value={form.admission?.capacity ?? ''}
                onChange={e => setAdmission('capacity', e.target.value ? parseInt(e.target.value) : undefined)} />
            </div>
            <div>
              <label htmlFor="adm-notes">准入备注</label>
              <textarea id="adm-notes" className="textarea" rows={2}
                value={form.admission?.notes ?? ''}
                onChange={e => setAdmission('notes', e.target.value)} />
            </div>
          </div>
        </div>

        {/* 直达二维码：打印张贴后骑手扫码直达详情页 / 离店 */}
        {!isNew && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              站内二维码（打印张贴）
            </h2>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <img
                  src={`/api/admin/points/${id}/qr`}
                  alt={`${form.name ?? '服务点'} 详情页二维码`}
                  style={{ width: '120px', height: '120px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: '#fff' }}
                />
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.375rem 0' }}>门口贴 · 直达详情页</p>
                <a href={`/api/admin/points/${id}/qr`} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>打开大图</a>
              </div>
              <div style={{ textAlign: 'center' }}>
                <img
                  src={`/api/admin/points/${id}/qr?type=checkout`}
                  alt={`${form.name ?? '服务点'} 离店码`}
                  style={{ width: '120px', height: '120px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: '#fff' }}
                />
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.375rem 0' }}>店内贴 · 扫码离店</p>
                <a href={`/api/admin/points/${id}/qr?type=checkout`} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>打开大图</a>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7, flex: 1, minWidth: '200px' }}>
                骑手预约后凭手机上的入店码进店（工作人员扫码确认）；离店时扫店内离店码，
                系统自动释放在店名额并收集满意度反馈。
                <br />
                <a href={`/point/${id}`} target="_blank" rel="noreferrer">预览详情页</a>
              </div>
            </div>
          </div>
        )}

        {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>⚠ {error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={() => router.back()}>取消</button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? '保存中…' : (isNew ? '创建服务点' : '保存更改')}
          </button>
        </div>
      </form>
    </>
  );
}
