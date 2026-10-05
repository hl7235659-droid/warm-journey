'use client';
export const runtime = 'edge';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { FEEDBACK_SUPPORT_TAGS } from '@/lib/types';
import type { Visit } from '@/lib/types';
import { getRiderToken } from '@/lib/rider';

type Stage = 'loading' | 'none' | 'confirm' | 'survey' | 'thanks';

// 骑手扫店内「离店码」打开的页面：确认离店 → 满意度卡片（仿美团单车结束骑行）
export default function CheckoutPage() {
  const { point_id: pointId } = useParams<{ point_id: string }>();
  const [stage, setStage] = useState<Stage>('loading');
  const [visit, setVisit] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 满意度卡片状态
  const [rating, setRating] = useState(0);
  const [supports, setSupports] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    const token = getRiderToken();
    fetch(`/api/visits/active?point_id=${pointId}&rider_token=${token}`)
      .then(r => r.json() as Promise<{ ok: boolean; data?: { visit: Visit | null } }>)
      .then(j => {
        const v = j.ok && j.data ? j.data.visit : null;
        setVisit(v);
        setStage(v && v.status === 'in_store' ? 'confirm' : 'none');
      })
      .catch(() => setStage('none'));
  }, [pointId]);

  async function handleCheckout() {
    if (!visit) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/visits/${visit.id}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rider_token: getRiderToken() }),
      });
      const j = await res.json() as { ok: boolean; error?: string };
      if (!j.ok) { setError(j.error ?? '操作失败，请重试'); return; }
      setStage('survey');
    } catch { setError('网络异常，请稍后重试'); }
    finally { setBusy(false); }
  }

  function toggleSupport(tag: string) {
    setSupports(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  async function handleFeedback(skip: boolean) {
    if (!visit) return;
    if (!skip && rating === 0) { setError('请先打个分'); return; }
    if (!skip) {
      setBusy(true); setError('');
      try {
        await fetch(`/api/visits/${visit.id}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rider_token: getRiderToken(), rating, supports, suggestion: suggestion.trim() }),
        });
      } catch { /* 反馈失败不阻塞 */ }
      finally { setBusy(false); }
    }
    setStage('thanks');
  }

  const duration = visit?.checked_in_at
    ? Math.max(1, Math.round((Date.now() / 1000 - visit.checked_in_at) / 60))
    : null;

  return (
    <div className="slide">
      <nav className="navbar">
        <a href={`/point/${pointId}`} className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem', color: 'var(--gold-300)' }}>← 返回</a>
        <span className="navbar-title">离店</span>
      </nav>

      <main className="page" style={{ paddingTop: '2.5rem', paddingBottom: '3rem' }}>
        {stage === 'loading' && (
          <div className="skeleton" style={{ height: '180px', borderRadius: 'var(--r-lg)' }} />
        )}

        {stage === 'none' && (
          <div style={{ textAlign: 'center' }}>
            <div className="done-seal" aria-hidden="true" style={{ background: 'var(--ink, #333)' }}>无</div>
            <h2 style={{ letterSpacing: '0.12em' }}>没有在店记录</h2>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', marginBottom: '1.5rem' }}>
              当前设备在该站点没有进行中的进店记录。
            </p>
            <a href={`/point/${pointId}`} className="btn btn-primary">查看服务点</a>
          </div>
        )}

        {stage === 'confirm' && visit && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ letterSpacing: '0.12em', marginBottom: '0.5rem' }}>确认离店？</h2>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', marginBottom: '1.5rem' }}>
              {duration !== null && `本次在店约 ${duration >= 60 ? `${Math.floor(duration / 60)} 小时 ${duration % 60} 分` : `${duration} 分钟`}。`}
              离店后名额将立即释放。
            </p>
            {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>※ {error}</p>}
            <button className="btn btn-primary btn-lg btn-full" onClick={handleCheckout} disabled={busy}>
              {busy ? '处理中…' : '确认离店'}
            </button>
          </div>
        )}

        {stage === 'survey' && (
          <div className="card anim-rise" style={{ maxWidth: '480px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <div className="done-seal" aria-hidden="true">安</div>
              <h2 style={{ letterSpacing: '0.12em', margin: '0.75rem 0 0.25rem' }}>一路平安</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontFamily: 'var(--font-sans)', margin: 0 }}>
                花 10 秒告诉我们这次的体验
              </p>
            </div>

            {/* 星级 */}
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>整体满意吗？</p>
              <div role="radiogroup" aria-label="满意度评分" style={{ display: 'flex', justifyContent: 'center', gap: '0.375rem' }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} 星`}
                    onClick={() => setRating(n)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: '2rem',
                      color: n <= rating ? 'var(--gold-500, #d4a017)' : 'var(--border)',
                      transition: 'transform .15s ease', transform: n <= rating ? 'scale(1.1)' : 'none',
                    }}
                  >★</button>
                ))}
              </div>
            </div>

            {/* 希望获得的支持 */}
            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>希望驿站增加哪些支持？（可多选）</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {FEEDBACK_SUPPORT_TAGS.map(tag => {
                  const on = supports.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => toggleSupport(tag)}
                      aria-pressed={on}
                      style={{
                        background: on ? 'var(--accent)' : 'var(--surface)',
                        color: on ? 'var(--accent-fg)' : 'var(--text-muted)',
                        borderColor: on ? 'var(--accent)' : 'var(--border)',
                      }}
                    >{tag}</button>
                  );
                })}
              </div>
            </div>

            {/* 改进建议 */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label htmlFor="suggestion" style={{ fontSize: '0.9rem', fontWeight: 600 }}>还有什么想说的？</label>
              <textarea
                id="suggestion"
                className="textarea"
                rows={3}
                maxLength={500}
                placeholder="改进建议、遇到的麻烦…（可选）"
                value={suggestion}
                onChange={e => setSuggestion(e.target.value)}
              />
            </div>

            {error && <p className="field-error" role="alert" style={{ marginBottom: '1rem' }}>※ {error}</p>}

            <div style={{ display: 'flex', gap: '0.625rem' }}>
              <button className="btn btn-ghost" onClick={() => void handleFeedback(true)} style={{ flexShrink: 0 }}>跳过</button>
              <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={() => void handleFeedback(false)} disabled={busy}>
                {busy ? '提交中…' : '提交反馈'}
              </button>
            </div>
          </div>
        )}

        {stage === 'thanks' && (
          <div style={{ textAlign: 'center' }}>
            <div className="done-seal" aria-hidden="true">谢</div>
            <h2 style={{ letterSpacing: '0.12em' }}>感谢反馈</h2>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', marginBottom: '1.5rem' }}>
              你的建议会直接送到驿站运营同学手里。
            </p>
            <a href="/" className="btn btn-primary">回到首页</a>
          </div>
        )}
      </main>
    </div>
  );
}
