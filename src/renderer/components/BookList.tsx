import { useGroupedByStatus } from '../store/selectors'
import { useBooksStore } from '../store/books'
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

interface BookListProps {
  filter?: BookStatus | 'all'
}

export function BookList({ filter = 'all' }: BookListProps): JSX.Element {
  const groups = useGroupedByStatus()
  const selectedId = useBooksStore((s) => s.selectedId)
  const select = useBooksStore((s) => s.select)

  const visible: BookStatus[] =
    filter === 'all' ? STATUS_ORDER : [filter]

  return (
    <div className="book-list">
      {visible.map((status) => {
        const items = groups[status]
        return (
          <section key={status} className="book-list-group">
            <h3>
              <StatusDot status={status} />
              {STATUS_LABELS[status]} <span className="count">({items.length})</span>
            </h3>
            {items.length === 0 ? (
              <p className="muted empty-hint">—</p>
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
                      <span className="read-count">第 {b.read_count} 次</span>
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
