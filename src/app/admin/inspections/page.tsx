'use client';
export const runtime = 'edge';

import { useState, useEffect, useCallback } from 'react';
import type { Inspection } from '@/lib/types';
import { INSPECTION_RESULT_LABELS } from '@/lib/types';

const RESULT_BADGE: Record<string, string> = {
  pass: 'badge-green', fail: 'badge-red', partial: 'badge-amber',
};

export default function AdminInspectionsPage() {
  const [items, setItems] = useState<Inspection[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ point_id: '', result: 'pass', notes: '' });
  const [images, setImages] = useState<{ key: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [points, setPoints] = useState<{ id: string; name: string }[]>([]);

  // 服务点下拉（替代手填 ID）
  useEffect(() => {
    fetch('/api/admin/points?page_size=100')
      .then(r => r.json() as Promise<{ ok: boolean; data?: { items: { id: string; name: string }[] } }>)
      .then(j => { if (j.ok && j.data) setPoints(j.data.items); })
      .catch(() => { /* 失败时仍可手填 ID */ });
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    if (images.length + files.length > 8) { alert('最多上传 8 张图片'); return; }
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) continue;
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const json = await res.json() as { ok: boolean; data?: { key: string; url: string } };
        if (json.ok && json.data) setImages(prev => [...prev, json.data!]);
      }
    } finally { setUploading(false); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), page_size: '20' });
      const r = await fetch(`/api/admin/inspections?${p}`);
      const j = await r.json() as { ok: boolean; data?: { items: Inspection[]; total: number } };
      if (j.ok && j.data) { setItems(j.data.items); setTotal(j.data.total); }
    } finally { setLoading(false); }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.point_id.trim()) { alert('请选择服务点'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/admin/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, images: images.map(i => i.key) }),
      });
      const j = await r.json() as { ok: boolean; error?: string };
      if (j.ok) { setShowForm(false); setForm({ point_id: '', result: 'pass', notes: '' }); setImages([]); void load(); }
      else alert(j.error ?? '提交失败');
    } finally { setSaving(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>巡检记录</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ 新建巡检</button>
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              {['服务点', '结果', '巡检员', '备注', '时间'].map(h => (
                <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? [1,2,3].map(i => (
              <tr key={i}>{[1,2,3,4,5].map(j => (
                <td key={j} style={{ padding: '0.75rem' }}><div className="skeleton" style={{ height: '16px', borderRadius: '4px' }} /></td>
              ))}</tr>
            )) : items.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无巡检记录</td></tr>
            ) : items.map(ins => (
              <tr key={ins.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  <a href={`/admin/points/${ins.point_id}`} style={{ textDecoration: 'none', color: 'inherit', fontSize: '0.82rem' }}>
                    {ins.point_id.slice(0, 8)}…
                  </a>
                </td>
                <td style={{ padding: '0.625rem 0.75rem' }}>
                  <span className={`badge ${RESULT_BADGE[ins.result] ?? ''}`}>{INSPECTION_RESULT_LABELS[ins.result] ?? ins.result}</span>
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  {ins.inspector_id ? ins.inspector_id.slice(0, 8) + '…' : '—'}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', maxWidth: '200px' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ins.notes ?? '—'}</div>
                  {ins.images.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.375rem' }}>
                      {ins.images.map(key => (
                        <a key={key} href={`/api/images/${key}`} target="_blank" rel="noreferrer">
                          <img src={`/api/images/${key}`} alt="巡检照片"
                            style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }} />
                        </a>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ padding: '0.625rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                  {new Date(ins.created_at * 1000).toLocaleDateString('zh-CN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← 上一页</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页 →</button>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>新建巡检记录</h2>
            <form onSubmit={submit} noValidate>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="ins-point">服务点</label>
                {points.length > 0 ? (
                  <select id="ins-point" className="select" value={form.point_id}
                    onChange={e => setForm(f => ({ ...f, point_id: e.target.value }))}>
                    <option value="">请选择…</option>
                    {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : (
                  <input id="ins-point" className="input" value={form.point_id}
                    onChange={e => setForm(f => ({ ...f, point_id: e.target.value }))}
                    placeholder="粘贴服务点 ID" required />
                )}
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label>巡检结果</label>
                <select className="select" value={form.result}
                  onChange={e => setForm(f => ({ ...f, result: e.target.value }))}>
                  <option value="pass">通过</option>
                  <option value="partial">部分通过</option>
                  <option value="fail">不通过</option>
                </select>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label id="ins-imgs-label">现场照片（可选，最多 8 张）</label>
                <div aria-labelledby="ins-imgs-label" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {images.map((img, i) => (
                    <div key={img.key} style={{ position: 'relative', width: '56px', height: '56px' }}>
                      <img src={img.url} alt={`已上传照片 ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border)' }} />
                      <button type="button" aria-label="移除这张照片"
                        onClick={() => setImages(prev => prev.filter(x => x.key !== img.key))}
                        style={{
                          position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px',
                          borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff',
                          fontSize: '11px', lineHeight: 1, cursor: 'pointer',
                        }}
                      >×</button>
                    </div>
                  ))}
                  {images.length < 8 && (
                    <label style={{
                      width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '1.5px dashed var(--border)', borderRadius: '4px', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: '1.2rem',
                    }}>
                      {uploading ? '…' : '+'}
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
                        onChange={handleFileChange} disabled={uploading}
                        style={{ display: 'none' }} aria-label="选择照片" />
                    </label>
                  )}
                </div>
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="ins-notes">备注</label>
                <textarea id="ins-notes" className="textarea" rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="可选…" />
              </div>
              <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '提交中…' : '提交'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
