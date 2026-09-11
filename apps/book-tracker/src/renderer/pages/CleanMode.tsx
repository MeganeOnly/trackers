import { useMemo, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { useSearchStore, matchBook } from '../store/search'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, BookStatus } from '@shared/types'
import { isBookDone } from '@shared/types'

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

interface CleanModeProps {
  /**
   * v2.x:日常模式点击作品 → 打开 BookNotesModal(聚合 主笔记 + 集笔记 + 角色笔记)
   * 而非切到编辑模式。`e` 快捷键仍直接进编辑模式,行为不变。
   */
  onOpenNotes: (id: string) => void
}

export function CleanMode({ onOpenNotes }: CleanModeProps): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()
  const query = useSearchStore((s) => s.query)
  const worksFilter = useSettingsStore((s) => s.worksFilter)
  const format = useSettingsStore((s) => s.format)

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

  /**
   * 日常模式点击作品 → 打开作品笔记 modal(v2.x 起)
   *
   * v2.x 之前是「切到编辑模式 + 选中该书」:跳到 EditMode,BookDetail 显示完整
   * 集笔记 + 进度条 + 笔记区 + 角色笔记 + 前置依赖。但用户日常在 CleanMode 只是
   * 想翻一翻笔记 / 看集数 / 加角色,不需要前置依赖 / 状态切换 / 进度调整等
   * 「管理操作」 —— 走 EditMode 反而要等大组件 mount,且跟 CleanMode「轻量浏览」
   * 心智错位。
   *
   * v2.x 改造:点作品 → 打开 BookNotesModal,只聚合「主笔记 + 集笔记 + 角色笔记」
   * 三块笔记相关面板(都是 EpisodesPanel / CharactersPanel / 主笔记 textarea),
   * **不**切到编辑模式。`e` 快捷键仍直接进编辑模式 —— 想完整管理作品再按 e。
   *
   * 理由:
   * - 「轻量浏览」vs「完整管理」是两种心智,分两个入口更清晰
   * - 主笔记通过 booksStore.update patch notes 单字段保存,**不**触发 BookDetail
   *   的整本保存,避免覆盖编辑模式中可能存在的未保存草稿(详见 BookNotesModal 注释)
   * - 不再切模式,CleanMode 视觉上下文保留(返回 modal 关闭后仍是日常模式)
   */
  function openNotes(id: string): void {
    onOpenNotes(id)
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
                {nowReading.progress.total != null
                  ? ` · ${nowReading.progress.current}/${nowReading.progress.total}`
                  : nowReading.progress.current > 0
                    ? ` · ${nowReading.progress.current} (连载中)`
                    : ''}
              </span>
            )}
          </p>
        )}
      </header>

      {format === 'focus-stack' ? (
        <FocusStackView
          readableList={readableList}
          finishedList={visibleBooks
            .filter((b) => isBookDone(b))
            .sort((a, b) => b.updated.localeCompare(a.updated))}
          focalBook={nowReading}
          query={query}
          byFilter={byFilter}
          onFinish={markFinished}
          onShelve={shelve}
          onOpenNotes={openNotes}
        />
      ) : (
        <>
          {readableList.length === 0 ? (
            <p className="muted empty-hint">
              {query ? '无匹配。' : '暂无已解锁的作品。先在右侧编辑模式加几部。'}
            </p>
          ) : (
            <ul className="clean-list">
              {readableList.map(({ book, refCount }) => (
                <li key={book.id} className={`clean-item kind-${book.kind}`}>
                  <div
                    className="clean-item-left"
                    onClick={() => openNotes(book.id)}
                    title="点击查看笔记(主笔记 / 集笔记 / 角色笔记)"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openNotes(book.id)
                      }
                    }}
                  >
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
                    {/* 快速操作按钮:加 stopPropagation 防止冒泡触发 li / clean-item-left 的 onClick,
                        否则点「搁置 / 看完」按钮会同时切模式 + 选中该作品(用户预期是只切状态) */}
                    <div className="quick-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-secondary" onClick={() => shelve(book.id)} title="搁置">
                        搁置
                      </button>
                      <button className="quick-finish" onClick={() => markFinished(book.id)} title="标记为已看/已读">
                        看完
                      </button>
                    </div>
                    <span className="tracker-id">{book.id}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
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
                      <li
                        key={b.id}
                        className="collapsed-item"
                        onClick={() => openNotes(b.id)}
                        title="点击查看笔记"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openNotes(b.id)
                          }
                        }}
                      >
                        <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
                        <span className="title">{b.title}</span>
                        <span className="author muted">{b.author}</span>
                        <button
                          className="restore-btn"
                          onClick={(e) => {
                            e.stopPropagation()
                            void restore(b)
                          }}
                          title="恢复"
                        >
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

/* ============================================================
 * focus-stack 视图:三段式(focal card + compact list + stamp wall)
 * 与 list / grid 平行的另一种 format,差异点在 CleanMode 布局结构。
 * ============================================================ */
interface FocusStackViewProps {
  readableList: { book: Book; refCount: number }[]
  finishedList: Book[]
  focalBook: Book | undefined
  query: string
  byFilter: (b: Book) => boolean
  onFinish: (id: string) => Promise<void>
  onShelve: (id: string) => Promise<void>
  /** v2.x 起:点击作品打开 BookNotesModal(取代 v1.6 的「切到编辑模式 + 选中」) */
  onOpenNotes: (id: string) => void
}

function FocusStackView({
  readableList,
  finishedList,
  focalBook,
  query,
  byFilter,
  onFinish,
  onShelve,
  onOpenNotes
}: FocusStackViewProps): JSX.Element {
  return (
    <div className="focus-stack">
      {/* 焦点卡:reading/watching 第一个(进行中) */}
      {focalBook && (
        <section
          className="focal-card"
          style={{ '--item-stripe': `var(--kind-${focalBook.kind})` } as React.CSSProperties}
          onClick={() => onOpenNotes(focalBook.id)}
          title="点击查看笔记(主笔记 / 集笔记 / 角色笔记)"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onOpenNotes(focalBook.id)
            }
          }}
        >
          <div className="focal-card-label">
            <span className="focal-card-eyebrow muted">当前焦点 · {WORK_KIND_LABELS[focalBook.kind]}</span>
            <span className="tracker-id">{focalBook.id}</span>
          </div>
          <h2 className="focal-card-title">{focalBook.title}</h2>
          <div className="focal-card-meta muted">
            {focalBook.author}
            {focalBook.year > 0 && ` · ${focalBook.year}`}
            {focalBook.read_count > 1 && ` · 第 ${focalBook.read_count} 次`}
          </div>
          {focalBook.progress && focalBook.progress.total != null && (
            <div className="focal-card-progress">
              <span className="focal-card-progress-text">
                {focalBook.progress.current}/{focalBook.progress.total}
              </span>
              <div className="focal-card-progress-bar">
                <div
                  className="focal-card-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.round((focalBook.progress.current / focalBook.progress.total) * 100))}%`
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* 紧凑清单:现在能看的(去掉 kind-tag,只留标题 + author + ref + 快速操作) */}
      {readableList.length > 0 && (
        <section className="compact-list-section">
          <h3 className="compact-list-header">现在能看 · {readableList.length}</h3>
          <ul className="compact-list">
            {readableList.map(({ book, refCount }) => (
              <li
                key={book.id}
                className="compact-item"
                style={{ '--item-stripe': `var(--kind-${book.kind})` } as React.CSSProperties}
                onClick={() => onOpenNotes(book.id)}
                title="点击查看笔记"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenNotes(book.id)
                  }
                }}
              >
                <span className="compact-item-title">{book.title}</span>
                <span className="compact-item-meta muted">
                  <span>{WORK_KIND_LABELS[book.kind]}</span>
                  <span> · {book.author}</span>
                  {refCount > 0 && <span> · 解锁 {refCount} 部</span>}
                </span>
                {/* 紧凑清单的快速操作按钮加 stopPropagation,避免点按钮同时切模式 + 选中 */}
                <span className="compact-item-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn-secondary btn-tiny"
                    onClick={() => void onShelve(book.id)}
                    title="搁置"
                  >
                    搁置
                  </button>
                  <button
                    className="btn-secondary btn-tiny"
                    onClick={() => void onFinish(book.id)}
                    title="标记为已看/已读"
                  >
                    看完
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 印章墙:已达成作品横排,每条带 StampChip 印章 */}
      {finishedList.length > 0 && (
        <section className="stamp-wall">
          <h3 className="stamp-wall-header">印章墙 · 已读 {finishedList.length}</h3>
          <div className="stamp-wall-grid">
            {finishedList.map((b) => (
              <article
                key={b.id}
                className="stamp-card"
                style={{ '--item-stripe': `var(--kind-${b.kind})` } as React.CSSProperties}
                onClick={() => onOpenNotes(b.id)}
                title="点击查看笔记"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenNotes(b.id)
                  }
                }}
              >
                <span className="stamp-card-id muted">№ {b.id}</span>
                <h4 className="stamp-card-title">{b.title}</h4>
                <span className="stamp-card-category muted">{WORK_KIND_LABELS[b.kind]}</span>
                <span className="tracker-stamp" data-state="finished">已读</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {readableList.length === 0 && !focalBook && finishedList.length === 0 && (
        <p className="muted empty-hint">
          {query ? '无匹配。' : '暂无已解锁的作品。先在右侧编辑模式加几部。'}
        </p>
      )}
    </div>
  )
}
