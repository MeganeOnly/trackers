import { useBooksStore } from '../store/books'
import { useEdgeFor, useUnlocked } from '../store/selectors'

const STATUS_LABELS = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
} as const

export function BookDetail(): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const book = books.find((b) => b.id === selectedId)
  const edge = useEdgeFor(selectedId)
  const { unlocked, cycles } = useUnlocked()

  if (!book) {
    return (
      <div className="detail-empty">
        <p className="muted">从左侧选一本书，或点右上角 + 加书。</p>
      </div>
    )
  }

  const isUnlocked = unlocked.get(book.id) ?? true
  const cycle = cycles.find((c) => c.includes(book.id))

  return (
    <article className="book-detail">
      <header className="detail-header">
        <h2>{book.title}</h2>
        <div className="meta-row">
          <span className={`status-pill status-${book.status}`}>
            {STATUS_LABELS[book.status]}
            {book.status === 'reading' && ` · 第 ${book.read_count} 次`}
          </span>
          {!isUnlocked && !cycle && <span className="lock-pill">未解锁</span>}
          {cycle && <span className="lock-pill error">循环依赖</span>}
        </div>
      </header>

      <dl className="detail-fields">
        <dt>作者</dt>
        <dd>{book.author || '—'}</dd>
        <dt>国家</dt>
        <dd>{book.country || '—'}</dd>
        <dt>年份</dt>
        <dd>{book.year || '—'}</dd>
        <dt>译者</dt>
        <dd>{book.translator || '—'}</dd>
        <dt>ID</dt>
        <dd>
          <code>{book.id}</code>
        </dd>
      </dl>

      {edge && (
        <section className="detail-prereqs">
          <h3>
            前置依赖 <span className="muted">({edge.prerequisites.length} 本)</span>
          </h3>
          {edge.rule === 'any_of' && (
            <p className="rule-tag">规则: 至少 {edge.threshold} 本</p>
          )}
          <ul>
            {edge.prerequisites.map((pid) => {
              const prereq = books.find((b) => b.id === pid)
              if (!prereq) {
                return (
                  <li key={pid} className="prereq prereq-missing">
                    <span className="title">{pid}</span>
                    <span className="muted">未找到</span>
                  </li>
                )
              }
              return (
                <li
                  key={pid}
                  className={`prereq status-${prereq.status}`}
                  onClick={() => useBooksStore.getState().select(pid)}
                >
                  <span className="title">{prereq.title}</span>
                  <span className={`status-tag status-${prereq.status}`}>
                    {STATUS_LABELS[prereq.status]}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <p className="muted hint-text">编辑表单留 Phase 5。</p>
    </article>
  )
}
