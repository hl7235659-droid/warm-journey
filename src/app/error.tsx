'use client';
export const runtime = 'edge';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '1rem' }}>出错了</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        {error.message || '页面加载时发生错误'}
      </p>
      <button className="btn btn-primary" onClick={reset}>
        重试
      </button>
    </div>
  );
}
