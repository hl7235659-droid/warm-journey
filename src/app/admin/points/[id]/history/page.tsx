'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { PointHistory } from '@/lib/types';
import { api } from '@/lib/api-client';

export default function PointHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [history, setHistory] = useState<PointHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void api<PointHistory[]>(`/api/admin/points/${id}/history`).then(j => {
      if (j.ok && j.data) setHistory(j.data);
      setLoading(false);
    });
  }, [id]);

  return (
    <>
      <div className="editor-head">
        <button className="btn btn-ghost btn-sm" onClick={() => router.back()}>← 返回</button>
        <h1 className="page-title">变更历史</h1>
      </div>

      {loading ? (
        <div className="stack">
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : history.length === 0 ? (
        <p className="empty-block" style={{ padding: '3rem 0' }}>暂无变更记录</p>
      ) : (
        <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
          {/* Timeline line */}
          <div style={{
            position: 'absolute', left: '6px', top: '8px', bottom: '8px',
            width: '2px', background: 'var(--border)',
          }} />

          <div className="stack">
            {history.map(h => {
              const open = expanded === h.id;
              const date = new Date(h.changed_at * 1000);
              return (
                <div key={h.id} style={{ position: 'relative' }}>
                  {/* Dot */}
                  <div style={{
                    position: 'absolute', left: '-1.375rem', top: '1rem',
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: 'var(--accent)', border: '2px solid var(--bg)',
                  }} />

                  <div className="card" style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : h.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
                          {date.toLocaleString('zh-CN')}
                        </p>
                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          由 {h.changed_by_name ?? h.changed_by ?? '未知操作人'} 更新
                        </p>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.25rem', userSelect: 'none' }}>
                        {open ? '▲' : '▼'} 快照
                      </span>
                    </div>

                    {open && (
                      <pre style={{
                        marginTop: '0.75rem', padding: '0.75rem',
                        background: 'var(--paper)', borderRadius: 'var(--r-md)',
                        fontSize: '0.75rem', lineHeight: 1.6,
                        overflow: 'auto', maxHeight: '320px',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        border: '1px solid var(--border-subtle)',
                      }}>
                        {JSON.stringify(h.snapshot, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
