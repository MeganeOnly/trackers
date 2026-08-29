import { useGroupedByStatus } from '../store/selectors'
import { useBooksStore } from '../store/books'
import { useSearchStore, matchBook } from '../store/search'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, BookStatus } from '@shared/types'

const STATUS_LABELS: Record<BookStatus, string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  watching: '在看',
  finished: '已读',
  abandoned: '弃读'
}

// 「进行中」(reading/watching) 排在最前；watching 紧接 reading 便于一眼看到同类目
const STATUS_ORDER: BookStatus[] = ['reading', 'watching', 'want', 'finished', 'shelved', 'abandoned']

function StatusDot({ status }: { status: BookStatus }): JSX.Element {
  return <span className={`status-dot status-${status}`} title={STATUS_LABELS[status]} />
}

export function BookList(): JSX.Element {
  const groups = useGroupedByStatus()
  const selectedId = useBooksStore((s) => s.selectedId)
  const select = useBooksStore((s) => s.select)
  const query = useSearchStore((s) => s.query)
  const worksFilter = useSettingsStore((s) => s.worksFilter)

  // 编辑模式侧栏"已收起"分组：跨 status 收集所有 collapsed=true 的作品，
  // 它们不再出现在原 status 分组里。book-tracker 原 CleanMode 不受影响（仍按 status 分组）。
  const collapsedItems = (): Book[] => groups.reading
    .concat(groups.watching, groups.want, groups.finished, groups.shelved, groups.abandoned)
    .filter((b) => b.collapsed)

  const filtered = (items: Book[]): Book[] =>
    items
      .filter((b) => matchBook(b, query))
      .filter((b) => worksFilter === 'all' || b.kind === worksFilter)
      .filter((b) => !b.collapsed)

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
                    <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
                    <span className="title">{b.title}</span>
                    {(b.status === 'reading' || b.status === 'watching') && (
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

      {/* 编辑模式"已收起"分组：跨 status 收集 collapsed=true 的作品；不影响 CleanMode 任何行为 */}
      <CollapsedSection items={collapsedItems()} worksFilter={worksFilter} />
    </div>
  )
}

interface CollapsedSectionProps {
  items: Book[]
  worksFilter: string
}

function CollapsedSection({ items, worksFilter }: CollapsedSectionProps): JSX.Element | null {
  const selectedId = useBooksStore((s) => s.selectedId)
  const select = useBooksStore((s) => s.select)
  const query = useSearchStore((s) => s.query)
  const filtered = items
    .filter((b) => matchBook(b, query))
    .filter((b) => worksFilter === 'all' || b.kind === worksFilter)
  if (items.length === 0) return null
  return (
    <section className="book-list-group book-list-group--collapsed">
      <h3>
        <span className="status-dot status-collapsed" title="在编辑模式侧栏已收起" />
        已收起{' '}
        <span className="count">
          ({query ? `${filtered.length}/${items.length}` : items.length})
        </span>
      </h3>
      {filtered.length === 0 ? (
        <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
      ) : (
        <ul>
          {filtered.map((b) => (
            <li
              key={b.id}
              className={selectedId === b.id ? 'selected' : ''}
              onClick={() => select(b.id)}
            >
              <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
              <span className="title">{b.title}</span>
              <span className="read-count">{STATUS_LABELS[b.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
