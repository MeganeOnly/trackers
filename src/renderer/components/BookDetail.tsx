import { useBooksStore } from '../store/books'
import { useEdgeFor, useUnlocked } from '../store/selectors'
import type { Book } from '@shared/types'

interface BookDetailProps {
  onEdit: () => void
}

const STATUS_LABELS = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
} as const

export function BookDetail({ onEdit }: BookDetailProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const select = useBooksStore((s) => s.select)
  const update = useBooksStore((s) => s.update)
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

  async function quickSetStatus(status: Book['status']): Promise<void> {
    if (!book) return
    await update(book.id, { status })
  }

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
        <div className="detail-actions">
          <button onClick={onEdit}>编辑</button>
          {book.status !== 'reading' && (
            <button className="btn-secondary" onClick={() => quickSetStatus('reading')}>
              开始读
            </button>
          )}
          {book.status !== 'finished' && (
            <button className="btn-secondary" onClick={() => quickSetStatus('finished')}>
              标记已读
            </button>
          )}
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
                  onClick={() => select(pid)}
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
    </article>
  )
}
