import { useMemo, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { useSearchStore, matchBook } from '../store/search'
import type { Book, BookStatus } from '@shared/types'

const COLLAPSED_SECTIONS: { key: BookStatus; label: string }[] = [
  { key: 'shelved', label: '搁置' },
  { key: 'finished', label: '已读' },
  { key: 'abandoned', label: '弃读' }
]

export function CleanMode(): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()
  const query = useSearchStore((s) => s.query)

  const [openSections, setOpenSections] = useState<Set<BookStatus>>(new Set())

  const nowReading = useMemo(() => books.find((b) => b.status === 'reading'), [books])

  const readableList = useMemo(() => {
    const refCount = new Map<string, number>()
    for (const b of books) refCount.set(b.id, 0)
    for (const e of edges) {
      for (const p of e.prerequisites) refCount.set(p, (refCount.get(p) ?? 0) + 1)
    }
    return books
      .filter((b) => b.status !== 'finished' && b.status !== 'abandoned' && b.status !== 'shelved')
      .filter((b) => unlocked.get(b.id))
      .filter((b) => matchBook(b, query))
      .map((book) => ({ book, refCount: refCount.get(book.id) ?? 0 }))
      .sort((a, b) => {
        if (b.refCount !== a.refCount) return b.refCount - a.refCount
        return a.book.title.localeCompare(b.book.title, 'zh')
      })
  }, [books, edges, unlocked, query])

  const collapsedLists: Record<BookStatus, Book[]> = useMemo(() => {
    const groups: Record<BookStatus, Book[]> = { want: [], shelved: [], reading: [], finished: [], abandoned: [] }
    for (const b of books) groups[b.status].push(b)
    for (const k of Object.keys(groups) as BookStatus[]) {
      groups[k] = groups[k]
        .filter((b) => matchBook(b, query))
        .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    }
    return groups
  }, [books, query])

  async function markFinished(id: string): Promise<void> {
    await update(id, { status: 'finished' })
  }
  async function shelve(id: string): Promise<void> {
    await update(id, { status: 'shelved' })
  }

  function toggle(key: BookStatus): void {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="page-clean">
      <header className="clean-header">
        <h2>
          现在能读的书 ({readableList.length}
          {query && readableList.length !== books.length ? ` / ${books.length}` : ''})
        </h2>
        {nowReading && (
          <p className="currently-reading">
            正在读: <strong>{nowReading.title}</strong>
            {nowReading.read_count > 1 && ` · 第 ${nowReading.read_count} 次`}
            {nowReading.progress && (
              <span className="currently-progress">
                {nowReading.progress.total !== null
                  ? ` · ${nowReading.progress.current}/${nowReading.progress.total} 章`
                  : nowReading.progress.current > 0
                    ? ` · ${nowReading.progress.current} 章 (连载中)`
                    : ''}
              </span>
            )}
          </p>
        )}
      </header>

      {readableList.length === 0 ? (
        <p className="muted empty-hint">
          {query ? '无匹配。' : '暂无未读已解锁的书。先在右侧编辑模式加几本。'}
        </p>
      ) : (
        <ul className="clean-list">
          {readableList.map(({ book, refCount }) => (
            <li key={book.id} className="clean-item">
              <div className="clean-item-left">
                <span className="title">{book.title}</span>
                <span className="author muted">{book.author}</span>
              </div>
              <div className="clean-item-right">
                <span
                  className="ref-badge"
                  style={{ visibility: refCount > 0 ? 'visible' : 'hidden' }}
                  aria-hidden={refCount > 0 ? undefined : true}
                >
                  解锁 {refCount} 本
                </span>
                <div className="quick-actions">
                  <button className="btn-secondary" onClick={() => shelve(book.id)} title="搁置">
                    搁置
                  </button>
                  <button className="quick-finish" onClick={() => markFinished(book.id)} title="标记为已读">
                    读完
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="collapsed-sections">
        {COLLAPSED_SECTIONS.map(({ key, label }) => {
          const items = collapsedLists[key]
          const open = openSections.has(key)
          return (
            <section key={key} className={`collapsed-section status-${key}`}>
              <button
                className="collapsed-header"
                onClick={() => toggle(key)}
                aria-expanded={open}
              >
                <span className={`status-dot status-${key}`} />
                <span className="label">{label}</span>
                <span className="count muted">({items.length})</span>
                <span className="caret">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <ul className="collapsed-list">
                  {items.length === 0 ? (
                    <li className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</li>
                  ) : (
                    items.map((b) => (
                      <li key={b.id} className="collapsed-item">
                        <span className="title">{b.title}</span>
                        <span className="author muted">{b.author}</span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
