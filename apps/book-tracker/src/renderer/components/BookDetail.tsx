import { useBooksStore } from '../store/books'
import { useUnlocked } from '../store/selectors'
import { PrereqEditor } from './PrereqEditor'
import { progressPercent } from '@core'
import { formatProgress } from '@shared/progress'
import type { Book } from '@shared/types'

interface BookDetailProps {
  onEdit: () => void
  /** 显式指定显示哪本书；不传则用全局 selectedId */
  bookId?: string
}

const STATUS_LABELS = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
} as const

export function BookDetail({ onEdit, bookId }: BookDetailProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)
  const bumpProgress = useBooksStore((s) => s.bumpProgress)
  const effectiveId = bookId ?? selectedId
  const book = books.find((b) => b.id === effectiveId)
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
  const pct = progressPercent(book.progress)

  async function quickSetStatus(status: Book['status']): Promise<void> {
    if (!book) return
    await update(book.id, { status })
  }

  async function handleBump(delta: number): Promise<void> {
    if (!book) return
    await bumpProgress(book.id, delta)
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

      {book.status === 'reading' && (
        <section className="progress-card">
          <div className="progress-card-header">
            <span className="progress-label">章节进度</span>
            <span className="progress-text">{formatProgress(book.progress) || '尚未记录'}</span>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-actions">
            <button className="btn-secondary" onClick={() => handleBump(-1)} title="回退 1 章">
              -1
            </button>
            <button className="btn-secondary" onClick={() => handleBump(+1)} title="读了 1 章">
              +1
            </button>
            <button className="btn-secondary" onClick={() => handleBump(+5)} title="读了 5 章">
              +5
            </button>
            <button className="quick-finish" onClick={() => quickSetStatus('finished')}>
              读完
            </button>
          </div>
        </section>
      )}

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

      <PrereqEditor bookId={book.id} />
    </article>
  )
}
