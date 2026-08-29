import { useMemo, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { useSearchStore, matchBook } from '../store/search'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, BookStatus } from '@shared/types'

const COLLAPSED_SECTIONS: { key: BookStatus; label: string }[] = [
  { key: 'shelved', label: '搁置' },
  { key: 'finished', label: '已读' },
  { key: 'abandoned', label: '弃读' }
]

/**
 * 折叠区条目"恢复"的目标状态：
 * - 搁置/弃读 → 想看（重新进入备选池）
 * - 已读 → 在读（再次观看）—— 注意:这里固定落到 reading,如果用户偏好 watching
 *   可在 BookDetail 手动切换；restore 是单步动作,不试图"智能选择" kind 适配的进行中状态
 */
const RESTORE_TO: Record<BookStatus, BookStatus> = {
  want: 'want',
  reading: 'reading',
  watching: 'reading',
  shelved: 'want',
  finished: 'reading',
  abandoned: 'want'
}

export function CleanMode(): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()
  const query = useSearchStore((s) => s.query)
  const worksFilter = useSettingsStore((s) => s.worksFilter)

  const [openSections, setOpenSections] = useState<Set<BookStatus>>(new Set())

  const byFilter = (b: Book): boolean => worksFilter === 'all' || b.kind === worksFilter
  const visibleBooks = useMemo(() => books.filter(byFilter), [books, worksFilter])

  // 顶部"正在看"指示：合并 reading + watching 两种「进行中」状态
  const nowReading = useMemo(
    () => visibleBooks.find((b) => b.status === 'reading' || b.status === 'watching'),
    [visibleBooks]
  )

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
      .filter(byFilter)
      .map((book) => ({ book, refCount: refCount.get(book.id) ?? 0 }))
      .sort((a, b) => {
        if (b.refCount !== a.refCount) return b.refCount - a.refCount
        return a.book.title.localeCompare(b.book.title, 'zh')
      })
  }, [books, edges, unlocked, query, worksFilter])

  const collapsedLists: Record<BookStatus, Book[]> = useMemo(() => {
    const groups: Record<BookStatus, Book[]> = {
      want: [], shelved: [], reading: [], watching: [], finished: [], abandoned: []
    }
    for (const b of books) groups[b.status].push(b)
    for (const k of Object.keys(groups) as BookStatus[]) {
      groups[k] = groups[k]
        .filter((b) => matchBook(b, query))
        .filter(byFilter)
        .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    }
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, query, worksFilter])

  async function markFinished(id: string): Promise<void> {
    await update(id, { status: 'finished' })
  }
  async function shelve(id: string): Promise<void> {
    await update(id, { status: 'shelved' })
  }
  async function restore(b: Book): Promise<void> {
    await update(b.id, { status: RESTORE_TO[b.status] })
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
          现在能看的作品 ({readableList.length}
          {query && readableList.length !== visibleBooks.length ? ` / ${visibleBooks.length}` : ''})
        </h2>
        {nowReading && (
          <p className="currently-reading">
            正在看: <strong>{nowReading.title}</strong>
            {nowReading.read_count > 1 && ` · 第 ${nowReading.read_count} 次`}
            {nowReading.progress && (
              <span className="currently-progress">
                {nowReading.progress.total !== null
                  ? ` · ${nowReading.progress.current}/${nowReading.progress.total}`
                  : nowReading.progress.current > 0
                    ? ` · ${nowReading.progress.current} (连载中)`
                    : ''}
              </span>
            )}
          </p>
        )}
      </header>

      {readableList.length === 0 ? (
        <p className="muted empty-hint">
          {query ? '无匹配。' : '暂无已解锁的作品。先在右侧编辑模式加几部。'}
        </p>
      ) : (
        <ul className="clean-list">
          {readableList.map(({ book, refCount }) => (
            <li key={book.id} className="clean-item">
              <div className="clean-item-left">
                <span className={`kind-tag kind-${book.kind}`}>{WORK_KIND_LABELS[book.kind]}</span>
                <span className="title">{book.title}</span>
                <span className="author muted">{book.author}</span>
              </div>
              <div className="clean-item-right">
                <span
                  className="ref-badge"
                  style={{ visibility: refCount > 0 ? 'visible' : 'hidden' }}
                  aria-hidden={refCount > 0 ? undefined : true}
                >
                  解锁 {refCount} 部
                </span>
                <div className="quick-actions">
                  <button className="btn-secondary" onClick={() => shelve(book.id)} title="搁置">
                    搁置
                  </button>
                  <button className="quick-finish" onClick={() => markFinished(book.id)} title="标记为已看/已读">
                    看完
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
                        <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
                        <span className="title">{b.title}</span>
                        <span className="author muted">{b.author}</span>
                        <button className="restore-btn" onClick={() => restore(b)} title="恢复">
                          恢复
                        </button>
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
