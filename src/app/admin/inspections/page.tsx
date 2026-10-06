'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyRow, LIST_PAGE_SIZE, Pager, SkeletonRows, useAdminList } from '@/components/admin/list';
import type { ListResp } from '@/components/admin/list';
import { ModalForm, useAdminForm } from '@/components/admin/modal-form';
import type { PagedResult, Inspection } from '@/lib/types';
import { INSPECTION_RESULT_LABELS } from '@/lib/types';
import { api } from '@/lib/api-client';
import { formatCNDate } from '@/lib/format';
import { uploadImages } from '@/lib/upload';
import type { UploadedImage } from '@/lib/upload';

const RESULT_BADGE: Record<Inspection['result'], string> = {
  pass: 'badge-green', fail: 'badge-red', partial: 'badge-amber',
};
const MAX_INSPECTION_IMAGES = 8;

const BLANK = () => ({ point_id: '', result: 'pass', notes: '' });

export default function AdminInspectionsPage() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [points, setPoints] = useState<{ id: string; name: string }[]>([]);

  const fetchInspections = useCallback(async (page: number): Promise<ListResp<Inspection>> => {
    const p = new URLSearchParams({ page: String(page), page_size: String(LIST_PAGE_SIZE) });
    const j = await api<PagedResult<Inspection>>(`/api/admin/inspections?${p}`);
    if (!j.ok) return { ok: false, error: j.error };
    return { ok: true, data: j.data.items, total: j.data.total };
  }, []);

  const { items, page, totalPages, loading, error, setPage, reload } = useAdminList(fetchInspections);

  const {
    showForm, saving, form, setForm, openForm, closeForm: closeBaseForm, submit,
  } = useAdminForm('/api/admin/inspections', {
    blank: BLANK, onSaved: reload, failureMode: 'alert', errorFallback: '提交失败',
  });

  function closeForm() {
    setImages([]);
    closeBaseForm();
  }

  // 服务点下拉（替代手填 ID）：失败时仍可手填
  useEffect(() => {
    void api<PagedResult<{ id: string; name: string }>>('/api/admin/points?page_size=100').then(j => {
      if (j.ok && j.data) setPoints(j.data.items);
    });
  }, []);

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.point_id.trim()) { alert('请选择服务点'); return; }
    const saved = await submit({ ...form, images: images.map(i => i.key) });
    if (saved) setImages([]);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    if (images.length + files.length > MAX_INSPECTION_IMAGES) { alert(`最多上传 ${MAX_INSPECTION_IMAGES} 张图片`); return; }
    setUploading(true);
    try {
      await uploadImages(files, img => setImages(prev => [...prev, img]));
    } catch (err) {
      alert((err as Error).message);
    } finally { setUploading(false); }
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">巡检记录</h1>
        <button className="btn btn-primary btn-sm" onClick={() => openForm()}>+ 新建巡检</button>
      </div>

      {error && <p className="field-error form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {['服务点', '结果', '巡检员', '备注', '时间'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <SkeletonRows cols={5} /> : items.length === 0 ? <EmptyRow cols={5} text="暂无巡检记录" /> :
              items.map(ins => (
                <tr key={ins.id}>
                  <td className="td-name">
                    <a href={`/admin/points/${ins.point_id}`} className="cell-link td-meta">
                      {ins.point_name ?? ins.point_id.slice(0, 8) + '…'}
                    </a>
                  </td>
                  <td>
                    <span className={`badge ${RESULT_BADGE[ins.result]}`}>{INSPECTION_RESULT_LABELS[ins.result]}</span>
                  </td>
                  <td className="td-meta">{ins.inspector_name ?? (ins.inspector_id ? ins.inspector_id.slice(0, 8) + '…' : '—')}</td>
                  <td className="td-muted" style={{ maxWidth: '200px' }}>
                    <div className="ellipsis">{ins.notes ?? '—'}</div>
                    {ins.images.length > 0 && (
                      <div className="flow-row" style={{ marginTop: '0.375rem' }}>
                        {ins.images.map(key => (
                          <a key={key} href={`/api/images/${key}`} target="_blank" rel="noreferrer">
                            <img src={`/api/images/${key}`} alt="巡检照片" className="thumb" />
                          </a>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="td-time">{formatCNDate(ins.created_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} totalPages={totalPages} onPage={setPage} />

      {showForm && (
        <ModalForm title="新建巡检记录" onClose={closeForm} onSubmit={submitForm}
          saving={saving} submitLabel="提交" savingLabel="提交中…">
          <div className="field">
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
          <div className="field">
            <label>巡检结果</label>
            <select className="select" value={form.result}
              onChange={e => setForm(f => ({ ...f, result: e.target.value }))}>
              <option value="pass">通过</option>
              <option value="partial">部分通过</option>
              <option value="fail">不通过</option>
            </select>
          </div>
          <div className="field">
            <label id="ins-imgs-label">现场照片（可选，最多 {MAX_INSPECTION_IMAGES} 张）</label>
            <div className="flow-row" aria-labelledby="ins-imgs-label" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
              {images.map((img, i) => (
                <div key={img.key} className="thumb-slot">
                  <img src={img.url} alt={`已上传照片 ${i + 1}`} />
                  <button type="button" aria-label="移除这张照片"
                    onClick={() => setImages(prev => prev.filter(x => x.key !== img.key))}
                    className="thumb-x"
                  >×</button>
                </div>
              ))}
              {images.length < MAX_INSPECTION_IMAGES && (
                <label className="thumb-pick">
                  {uploading ? '…' : '+'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
                    onChange={handleFileChange} disabled={uploading} aria-label="选择照片" />
                </label>
              )}
            </div>
          </div>
          <div className="field-lg">
            <label htmlFor="ins-notes">备注</label>
            <textarea id="ins-notes" className="textarea" rows={3} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="可选…" />
          </div>
        </ModalForm>
      )}
    </>
  );
}
