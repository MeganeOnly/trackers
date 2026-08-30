import { useCallback, useEffect, useMemo, useState } from 'react'
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

/** localStorage 持久化键：哪些侧栏 section 当前处于『收起』状态 */
const COLLAPSED_SECTIONS_STORAGE_KEY = 'book-tracker:sidebar:collapsed-sections'

/**
 * 侧栏 section 可折叠状态 hook：
 * - 用字符串集合存当前收起的 section（不在集合里的 = 展开）；
 * - 自动同步到 localStorage，刷新页面保持上次状态；
 * - 解析失败兜底返回空集（优雅降级）。
 */
function useCollapsibleSections(): {
  isCollapsed: (key: string) => boolean
  toggle: (key: string) => void
} {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  })

  const isCollapsed = useCallback(
    (key: string) => collapsed.includes(key),
    [collapsed]
  )

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* localStorage 不可用（隐私模式 / quota）不影响 in-memory 状态 */
      }
      return next
    })
  }, [])

  // 跨多 tab 同步：localStorage 更新时让本 tab 跟随
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key !== COLLAPSED_SECTIONS_STORAGE_KEY || e.newValue === null) return
      try {
        const parsed = JSON.parse(e.newValue)
        if (Array.isArray(parsed)) {
          setCollapsed(parsed.filter((k): k is string => typeof k === 'string'))
        }
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { isCollapsed, toggle }
}

function StatusDot({ status }: { status: BookStatus }): JSX.Element {
  return <span className={`status-dot status-${status}`} title={STATUS_LABELS[status]} />
}

/** 列表模式 li —— 紧凑文字流(default / focus-stack) */
function ItemRowList({
  b,
  selected,
  onSelect,
  showStatusLabel = false
}: {
  b: Book
  selected: boolean
  onSelect: (id: string) => void
  showStatusLabel?: boolean
}): JSX.Element {
  return (
    <li
      className={`kind-${b.kind}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(b.id)}
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
      {showStatusLabel && b.status !== 'reading' && b.status !== 'watching' && (
        <span className="read-count">{STATUS_LABELS[b.status]}</span>
      )}
      <span className="tracker-id">{b.id}</span>
    </li>
  )
}

/** 网格模式 li —— 借阅卡式方角卡片(grid format) */
function ItemRowCard({
  b,
  selected,
  onSelect
}: {
  b: Book
  selected: boolean
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <li
      className={`book-card-grid kind-${b.kind}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(b.id)}
    >
      <div className="book-card-grid-header">
        <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
        <span className="tracker-id">{b.id}</span>
      </div>
      <h3 className="book-card-grid-title">{b.title}</h3>
      <div className="book-card-grid-author muted">
        {b.author}
        {b.year > 0 && ` · ${b.year}`}
      </div>
      {(b.status === 'reading' || b.status === 'watching') && b.progress && (
        <div className="book-card-grid-progress">
          {b.progress.current}
          {b.progress.total ? `/${b.progress.total}` : '+'}
          {b.read_count > 1 && ` · 第 ${b.read_count} 次`}
        </div>
      )}
      {b.status === 'finished' && (
        <span className="tracker-stamp" data-state="finished">已读</span>
      )}
    </li>
  )
}

/** 根据当前 format 选 list 或 grid li 渲染 */
function ItemRow(props: {
  b: Book
  selected: boolean
  onSelect: (id: string) => void
  showStatusLabel?: boolean
}): JSX.Element {
  const format = useSettingsStore((s) => s.format)
  return format === 'grid' ? (
    <ItemRowCard b={props.b} selected={props.selected} onSelect={props.onSelect} />
  ) : (
    <ItemRowList
      b={props.b}
      selected={props.selected}
      onSelect={props.onSelect}
      showStatusLabel={props.showStatusLabel}
    />
  )
}

export function BookList(): JSX.Element {
  const groups = useGroupedByStatus()
  const selectedId = useBooksStore((s) => s.selectedId)
  const select = useBooksStore((s) => s.select)
  const query = useSearchStore((s) => s.query)
  const worksFilter = useSettingsStore((s) => s.worksFilter)
  const format = useSettingsStore((s) => s.format)
  const { isCollapsed, toggle } = useCollapsibleSections()

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
        const sectionKey = `status:${status}`
        const collapsed = isCollapsed(sectionKey)
        return (
          <section
            key={status}
            className={`book-list-group book-list-group--collapsible${collapsed ? ' is-collapsed' : ''}`}
          >
            <button
              type="button"
              className="group-header"
              onClick={() => toggle(sectionKey)}
              aria-expanded={!collapsed}
              title={collapsed ? '点击展开' : '点击收起'}
            >
              <StatusDot status={status} />
              <span className="group-name">{STATUS_LABELS[status]}</span>
              <span className="count">
                ({query ? `${items.length}/${totalCount}` : totalCount})
              </span>
              <span className="caret" aria-hidden="true">
                {collapsed ? '▸' : '▾'}
              </span>
            </button>
            {!collapsed &&
              (items.length === 0 ? (
                <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
              ) : (
                <ul className={format === 'grid' ? 'book-grid' : undefined}>
                  {items.map((b) => (
                    <ItemRow
                      key={b.id}
                      b={b}
                      selected={selectedId === b.id}
                      onSelect={select}
                    />
                  ))}
                </ul>
              ))}
          </section>
        )
      })}

      {/* 编辑模式"已收起"分组：跨 status 收集 collapsed=true 的作品，按 status 再拆子分组（每子分组
          独立可折叠）。不影响 CleanMode 任何行为（仍按 status 分组）。 */}
      <CollapsedBucket
        collapsedItems={collapsedItems()}
        worksFilter={worksFilter}
        isCollapsed={isCollapsed}
        toggle={toggle}
      />
    </div>
  )
}

interface CollapsedBucketProps {
  collapsedItems: Book[]
  worksFilter: string
  isCollapsed: (key: string) => boolean
  toggle: (key: string) => void
}

/**
 * 「已收起」bucket + 子分组：
 * - 外层 bucket header 自身可折叠（收起 → 整片 + 子分组一起收）；
 * - 展开 bucket → 各 status 子分组仍按自己 sectionKey 自管折叠；
 * - 空子分组不渲染（与 life-tracker GoalList 同款）。
 *
 * 渲染顺序沿用顶部 STATUS_ORDER —— 在读 / 在看排前面便于一眼看到「进行中」内被收起的；
 * 跟顶部 status 分组同款顺序，「所有被收起的」按 status 顺序收束到一块。
 */
function CollapsedBucket({
  collapsedItems,
  worksFilter,
  isCollapsed,
  toggle
}: CollapsedBucketProps): JSX.Element | null {
  const selectedId = useBooksStore((s) => s.selectedId)
  const select = useBooksStore((s) => s.select)
  const query = useSearchStore((s) => s.query)
  const format = useSettingsStore((s) => s.format)

  // 按 status 分组：跨 status 收集所有 collapsed=true 的作品。
  const collapsedByStatus = useMemo<Record<BookStatus, Book[]>>(() => {
    const out: Record<BookStatus, Book[]> = {
      reading: [],
      watching: [],
      want: [],
      finished: [],
      shelved: [],
      abandoned: []
    }
    for (const b of collapsedItems) out[b.status].push(b)
    return out
  }, [collapsedItems])

  const filteredByStatus = useMemo<Record<BookStatus, Book[]>>(() => {
    const out = {} as Record<BookStatus, Book[]>
    for (const status of STATUS_ORDER) {
      out[status] = collapsedByStatus[status]
        .filter((b) => matchBook(b, query))
        .filter((b) => worksFilter === 'all' || b.kind === worksFilter)
    }
    return out
  }, [collapsedByStatus, query, worksFilter])

  const totalCount = collapsedItems.length
  const matchedCount = STATUS_ORDER.reduce(
    (sum, s) => sum + filteredByStatus[s].length,
    0
  )
  if (totalCount === 0) return null

  // 外层 bucket header 自身也走折叠机制
  const bucketKey = 'collapsed:bucket'
  const bucketCollapsed = isCollapsed(bucketKey)
  return (
    <section
      className={`book-list-group book-list-group--collapsed-bucket book-list-group--collapsible${bucketCollapsed ? ' is-collapsed' : ''}`}
    >
      <button
        type="button"
        className="group-header group-header--bucket"
        onClick={() => toggle(bucketKey)}
        aria-expanded={!bucketCollapsed}
        title={bucketCollapsed ? '点击展开' : '点击收起'}
      >
        <span className="status-dot status-collapsed" title="在编辑模式侧栏已收起" />
        <span className="group-name">已收起</span>
        <span className="count">
          ({query ? `${matchedCount}/${totalCount}` : totalCount})
        </span>
        <span className="caret" aria-hidden="true">
          {bucketCollapsed ? '▸' : '▾'}
        </span>
      </button>
      {!bucketCollapsed && (
        <div className="bucket-subs">
          {STATUS_ORDER.map((status) => {
            const items = filteredByStatus[status]
            const totalForStatus = collapsedByStatus[status].length
            if (totalForStatus === 0) return null
            const subKey = `collapsed:${status}`
            const subCollapsed = isCollapsed(subKey)
            return (
              <section
                key={status}
                className={`book-list-group book-list-group--sub book-list-group--collapsible${subCollapsed ? ' is-collapsed' : ''}`}
              >
                <button
                  type="button"
                  className="group-header group-header--sub"
                  onClick={() => toggle(subKey)}
                  aria-expanded={!subCollapsed}
                  title={subCollapsed ? '点击展开' : '点击收起'}
                >
                  <StatusDot status={status} />
                  <span className="group-name">{STATUS_LABELS[status]}</span>
                  <span className="count">
                    ({query ? `${items.length}/${totalForStatus}` : totalForStatus})
                  </span>
                  <span className="caret" aria-hidden="true">
                    {subCollapsed ? '▸' : '▾'}
                  </span>
                </button>
                {!subCollapsed &&
                  (items.length === 0 ? (
                    <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
                  ) : (
                    <ul className={format === 'grid' ? 'book-grid' : undefined}>
                      {items.map((b) => (
                        <ItemRow
                          key={b.id}
                          b={b}
                          selected={selectedId === b.id}
                          onSelect={select}
                          showStatusLabel
                        />
                      ))}
                    </ul>
                  ))}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}