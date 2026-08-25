import { useGroupedByStatus } from '../store/selectors'
import { useBooksStore } from '../store/books'
import { useSearchStore, matchBook } from '../store/search'
import type { Book, BookStatus } from '@shared/types'

const STATUS_LABELS: Record<BookStatus, string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
}

const STATUS_ORDER: BookStatus[] = ['reading', 'want', 'finished', 'shelved', 'abandoned']

function StatusDot({ status }: { status: BookStatus }): JSX.Element {
  return <span className={`status-dot status-${status}`} title={STATUS_LABELS[status]} />
}

export function BookList(): JSX.Element {
  const groups = useGroupedByStatus()
  const selectedId = useBooksStore((s) => s.selectedId)
  const select = useBooksStore((s) => s.select)
  const query = useSearchStore((s) => s.query)

  const filtered = (items: Book[]): Book[] => items.filter((b) => matchBook(b, query))

  return (
    <div className="book-list">
      {STATUS_ORDER.map((status) => {
        const items = filtered(groups[status])
        const totalCount = groups[status].length
        return (
          <section key={status} className="book-list-group">
            <h3>
              <StatusDot status={status} />
              {STATUS_LABELS[status]}{' '}
              <span className="count">
                ({query ? `${items.length}/${totalCount}` : totalCount})
              </span>
            </h3>
            {items.length === 0 ? (
              <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
            ) : (
              <ul>
                {items.map((b) => (
                  <li
                    key={b.id}
                    className={selectedId === b.id ? 'selected' : ''}
                    onClick={() => select(b.id)}
                  >
                    <span className="title">{b.title}</span>
                    {b.status === 'reading' && (
                      <span className="read-count">
                        {b.progress
                          ? `${b.progress.current}${b.progress.total ? `/${b.progress.total}` : '+'}`
                          : '—'}
                        {b.read_count > 1 && ` · 第 ${b.read_count} 次`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
