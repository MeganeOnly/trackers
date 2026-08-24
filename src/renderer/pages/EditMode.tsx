export function EditMode(): JSX.Element {
  return (
    <div className="page-edit">
      <aside className="sidebar">
        <div className="sidebar-section">
          <h3>全部 (—)</h3>
          <p className="muted">Phase 4.2 会拉数据</p>
        </div>
      </aside>
      <main className="detail-panel">
        <p className="muted">从左侧选一本书，或点 + 加书。</p>
      </main>
    </div>
  )
}
