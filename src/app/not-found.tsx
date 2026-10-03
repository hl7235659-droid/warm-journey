export default function NotFound() {
  return (
    <>
      <nav className="navbar">
        <a href="/" className="btn btn-ghost btn-sm" style={{ padding: '0 0.5rem' }}>← 首页</a>
        <span style={{ fontWeight: 600 }}>页面不存在</span>
      </nav>
      <main className="page" style={{ paddingTop: '4rem', textAlign: 'center' }}>
        <p style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🔍</p>
        <h1 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>找不到页面</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
          该服务点可能已下线，或链接有误。
        </p>
        <a href="/" className="btn btn-primary">返回服务点列表</a>
      </main>
    </>
  );
}
