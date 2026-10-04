'use client';
export const runtime = 'edge';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { REPORT_CATEGORY_LABELS } from '@/lib/types';
import type { ReportCategory } from '@/lib/types';

const CATEGORIES = Object.entries(REPORT_CATEGORY_LABELS) as [ReportCategory, string][];

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [category, setCategory] = useState<ReportCategory>('info_wrong');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [contentTouched, setContentTouched] = useState(false);

  const contentErr = contentTouched && content.trim().length < 5 ? '请至少描述 5 个字' : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContentTouched(true);
    if (content.trim().length < 5) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ point_id: params.id, category, content: content.trim(), images: [] }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) { setError(json.error ?? '提交失败，请重试'); return; }
      setDone(true);
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return (
    <>
      <nav className="navbar">
        <a href={`/point/${params.id}`} className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem' }}>← 返回</a>
        <span style={{ fontWeight: 600 }}>上报异常</span>
      </nav>
      <main className="page" style={{ paddingTop: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</p>
        <h2 style={{ marginBottom: '0.5rem' }}>上报成功</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>感谢您的反馈，管理员会尽快核实处理。</p>
        <a href={`/point/${params.id}`} className="btn btn-primary">返回服务点</a>
      </main>
    </>
  );

  return (
    <>
      <nav className="navbar">
        <a href={`/point/${params.id}`} className="btn btn-ghost btn-sm" aria-label="返回" style={{ padding: '0 0.5rem' }}>← 返回</a>
        <span style={{ fontWeight: 600 }}>上报异常</span>
      </nav>

      <main className="page" style={{ paddingTop: '1.25rem' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
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
              <p id="content-err" className="field-error" role="alert">⚠ {contentErr}</p>
            )}
            <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.25rem', textAlign: 'right' }}>
              {content.length}/500
            </p>
          </div>

          {error && (
            <p className="field-error" role="alert" style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
              ⚠ {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={submitting}>
            {submitting ? '提交中…' : '提交上报'}
          </button>
        </form>
      </main>
    </>
  );
}
