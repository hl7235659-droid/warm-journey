'use client';
export const runtime = 'edge';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 细节只进控制台：error.message 可能携带 D1 错误 / 堆栈片段，不展示给用户
  console.error('page error:', error.message, error.digest ?? '');
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '1rem' }}>出错了</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        页面加载时发生错误，请稍后重试
      </p>
      <button className="btn btn-primary" onClick={reset}>
        重试
      </button>
    </div>
  );
}
