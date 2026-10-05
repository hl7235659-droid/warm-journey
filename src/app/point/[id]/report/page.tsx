'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { REPORT_CATEGORY_LABELS } from '@/lib/types';
import type { ReportCategory } from '@/lib/types';
import { api } from '@/lib/api-client';
import { LS_KEYS, MY_REPORTS_MAX, readList, writeList } from '@/lib/local';
import type { MyReport } from '@/lib/local';
import { uploadImages } from '@/lib/upload';
import type { UploadedImage } from '@/lib/upload';

const CATEGORIES = Object.entries(REPORT_CATEGORY_LABELS) as [ReportCategory, string][];

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const [category, setCategory] = useState<ReportCategory>('info_wrong');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [queryCode, setQueryCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [contentTouched, setContentTouched] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清理复制提示的定时器，防止对已卸载组件 setState
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  // AI 带路预填：?category=facility 等（白名单校验）
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('category');
    if (c && c in REPORT_CATEGORY_LABELS) setCategory(c as ReportCategory);
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    if (images.length + files.length > 3) { setError('最多上传 3 张图片'); return; }
    setUploading(true);
    setError('');
    try {
      await uploadImages(files, img => setImages(prev => [...prev, img]));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const contentErr = contentTouched && content.trim().length < 5 ? '请至少描述 5 个字' : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContentTouched(true);
    if (content.trim().length < 5) return;
    setSubmitting(true);
    setError('');
    const json = await api<{ query_code?: string }>('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point_id: params.id, category, content: content.trim(), images: images.map(i => i.key) }),
    });
    setSubmitting(false);
    if (!json.ok) { setError(json.error ?? '提交失败，请重试'); return; }
    const code = json.data.query_code ?? '';
    setQueryCode(code);
    if (code) {
      writeList<MyReport>(LS_KEYS.myReports,
        [{ code, point_id: params.id, ts: Date.now() }, ...readList<MyReport>(LS_KEYS.myReports, MY_REPORTS_MAX)],
        MY_REPORTS_MAX);
    }
    setDone(true);
  }

  if (done) return (
    <div className="slide">
      <nav className="navbar">
        <a href={`/point/${params.id}`} className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem', color: 'var(--gold-300)' }}>← 返回</a>
        <span className="navbar-title">上报异常</span>
      </nav>
      <main className="page" style={{ paddingTop: '3rem', textAlign: 'center', paddingBottom: '3rem' }}>
        <div className="done-seal" aria-hidden="true">妥</div>
        <h2 style={{ marginBottom: '0.5rem', letterSpacing: '0.12em' }}>上报成功</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontFamily: 'var(--font-sans)' }}>感谢您的反馈，管理员会尽快核实处理。</p>
        {queryCode && (
          <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
            <p style={{ margin: '0 0 0.375rem', fontSize: '0.82rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
              查询码（凭它随时查看处理进度）
            </p>
            <p style={{ margin: '0 0 0.625rem', fontSize: '1.15rem', fontWeight: 700, letterSpacing: '0.14em', fontFamily: 'monospace', color: 'var(--red-800)' }}>
              {queryCode}
            </p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                navigator.clipboard.writeText(queryCode).then(() => {
                  setCodeCopied(true);
                  if (copyTimer.current) clearTimeout(copyTimer.current);
                  copyTimer.current = setTimeout(() => setCodeCopied(false), 2000);
                });
              }}
            >
              {codeCopied ? '已复制' : '复制查询码'}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'center' }}>
          <a href={`/point/${params.id}`} className="btn btn-primary">返回服务点</a>
          <a href="/report-status" className="btn btn-secondary">查询进度</a>
        </div>
      </main>
    </div>
  );

  return (
    <div className="slide">
      <nav className="navbar">
        <a href={`/point/${params.id}`} className="btn btn-ghost btn-sm" aria-label="返回" style={{ padding: '0 0.5rem', color: 'var(--gold-300)' }}>← 返回</a>
        <span className="navbar-title">上报异常</span>
      </nav>

      <main className="page" style={{ paddingTop: '1.25rem', paddingBottom: '2.5rem' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', fontFamily: 'var(--font-sans)' }}>
          匿名上报，无需登录。信息仅用于核实和改善服务点质量。
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: '1.25rem' }}>
            <label id="cat-label">问题类型</label>
            <div role="group" aria-labelledby="cat-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {CATEGORIES.map(([val, label]) => (
                <label
                  key={val}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                    padding: '0.75rem 1rem',
                    border: `1.5px solid ${category === val ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-md)',
                    background: category === val ? 'oklch(from var(--accent) l c h / .07)' : 'var(--surface)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    fontWeight: category === val ? 600 : 400,
                  }}
                >
                  <input
                    type="radio"
                    name="category"
                    value={val}
                    checked={category === val}
                    onChange={() => setCategory(val)}
                    style={{ accentColor: 'var(--accent)', width: '18px', height: '18px', flexShrink: 0 }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="content">详细描述</label>
            <textarea
              id="content"
              className={`textarea${contentErr ? ' input-error' : ''}`}
              placeholder="请描述您遇到的问题，例如：站点已关闭但信息未更新、充电桩损坏…"
              value={content}
              onChange={e => setContent(e.target.value)}
              onBlur={() => setContentTouched(true)}
              rows={4}
              maxLength={500}
              aria-describedby={contentErr ? 'content-err' : undefined}
              aria-invalid={!!contentErr}
            />
            {contentErr && (
              <p id="content-err" className="field-error" role="alert">※ {contentErr}</p>
            )}
            <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.25rem', textAlign: 'right' }}>
              {content.length}/500
            </p>
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label id="imgs-label">现场照片（可选，最多 3 张）</label>
            <div aria-labelledby="imgs-label" style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {images.map((img, i) => (
                <div key={img.key} style={{ position: 'relative', width: '72px', height: '72px' }}>
                  <img src={img.url} alt={`已上传照片 ${i + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }} />
                  <button
                    type="button"
                    aria-label="移除这张照片"
                    onClick={() => setImages(prev => prev.filter(x => x.key !== img.key))}
                    style={{
                      position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px',
                      borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff',
                      fontSize: '12px', lineHeight: 1, cursor: 'pointer',
                    }}
                  >×</button>
                </div>
              ))}
              {images.length < 3 && (
                <label style={{
                  width: '72px', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1.5px dashed var(--border)', borderRadius: 'var(--r-md)', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '1.4rem',
                }}>
                  {uploading ? '…' : '+'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
                    onChange={handleFileChange} disabled={uploading}
                    style={{ display: 'none' }} aria-label="选择照片" />
                </label>
              )}
            </div>
          </div>

          {error && (
            <p className="field-error" role="alert" style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
              ※ {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={submitting || uploading}>
            {submitting ? '提交中…' : uploading ? '图片上传中…' : '提交上报'}
          </button>
        </form>
      </main>
    </div>
  );
}
