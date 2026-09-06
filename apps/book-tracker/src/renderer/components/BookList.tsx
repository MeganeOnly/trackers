import { useCallback, useEffect, useMemo, useState } from 'react'
import { useGroupedByStatus } from '../store/selectors'
import { useBooksStore } from '../store/books'
import { useSearchStore, matchBook } from '../store/search'
import { useSettingsStore } from '../store/settings'
import { useSeriesStore } from '../store/series'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, BookStatus, Series } from '@shared/types'
import { STATUS_LABELS, SIDEBAR_STATUS_ORDER } from './BookDetail.labels'
import { SeriesRowInSidebar } from './SeriesRowInSidebar'
import { SidebarSeriesView } from './SidebarSeriesView'

// 本地别名 —— 原代码用 STATUS_ORDER / STATUS_LABELS 直接引用,改名后保持原写法
const STATUS_ORDER = SIDEBAR_STATUS_ORDER

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

/**
 * 网格模式 li —— 借阅卡式方角卡片(grid format)
 *
 * 单行流式布局：kind-tag → title → author/year → progress → id；stamp(finished)绝对定位
 * 到右上角,不挤占主行。默认 ~36px 高（title 1 行）；title 过长(line-clamp: 2)允许折到
 * 第 2 行,卡片自然撑到 2 行高。
 */
function ItemRowCard({
  b,
  selected,
  onSelect
}: {
  b: Book
  selected: boolean
  onSelect: (id: string) => void
}): JSX.Element {
  const progress =
    (b.status === 'reading' || b.status === 'watching') && b.progress
      ? b.progress
      : null
  const hasAuthor = !!b.author || b.year > 0
  return (
    <li
      className={`book-card-grid kind-${b.kind}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(b.id)}
    >
      <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
      <h3 className="book-card-grid-title">{b.title}</h3>
      {hasAuthor && (
        <span className="book-card-grid-author muted">
          {b.author}
          {b.year > 0 && ` · ${b.year}`}
        </span>
      )}
      {progress && (
        <span className="book-card-grid-progress muted">
          {progress.current}
          {progress.total ? `/${progress.total}` : '+'}
          {b.read_count > 1 && ` · 第 ${b.read_count} 次`}
        </span>
      )}
      <span className="tracker-id">{b.id}</span>
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
  const setSeries = useBooksStore((s) => s.setSeries)
  const books = useBooksStore((s) => s.books)
  const query = useSearchStore((s) => s.query)
  const worksFilter = useSettingsStore((s) => s.worksFilter)
  const format = useSettingsStore((s) => s.format)
  // v2.x:侧栏系列入口 —— 系列徽章 + series 视图切换都需要 series 全量
  const seriesList = useSeriesStore((s) => s.series)
  const loadSeries = useSeriesStore((s) => s.load)
  const { isCollapsed, toggle } = useCollapsibleSections()

  // v2.x:点 series 徽章切到该 series 的成员视图(null = 正常 status 分组视图)。
  // 仅 UI 视图态,不入 store —— BookList 局部 useState 管即可,不需要跨组件联动。
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)

  // 兜底:App.tsx 已 Promise.all([loadBooks, loadRelations, loadSeries]),但用户清空数据目录
  // 再切回等边界场景下 BookList 首次 mount 时 seriesList 可能为空 —— 这里再 loadSeries 一次。
  // (去重入:seriesList.length === 0 才调,避免 mount 后空状态触发多次 reload。)
  useEffect(() => {
    if (seriesList.length === 0) {
      void loadSeries()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // v2.x 全量聚合:seriesId → 该 series 的所有 books(跨 status / 跨 collapsed)。
  // 一个 series 可以出现在多个 status 分组里(成员跨 status),所以 booksBySeriesId
  // 不按 status 切,每 series 一份完整成员列表。
  const booksBySeriesId = useMemo<Map<string, Book[]>>(() => {
    const map = new Map<string, Book[]>()
    for (const b of books) {
      if (!b.seriesId) continue
      const arr = map.get(b.seriesId) ?? []
      arr.push(b)
      map.set(b.seriesId, arr)
    }
    return map
  }, [books])

  // v2.x 搜索匹配:系列名 OR 任一成员 book 名/作者/ID 包含 query 的 series id 集合。
  // null = 没在搜索,所有 series 视为匹配。
  const matchingSeriesIds = useMemo<Set<string> | null>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const out = new Set<string>()
    for (const s of seriesList) {
      if (s.name.toLowerCase().includes(q)) {
        out.add(s.id)
        continue
      }
      const members = booksBySeriesId.get(s.id) ?? []
      if (members.some((b) => matchBook(b, query))) {
        out.add(s.id)
      }
    }
    return out
  }, [query, seriesList, booksBySeriesId])

  // v2.x 搜索去重:每个 matching series "首次出现"的 status —— 一个 series 跨多个 status
  // 时,只在第一个含它的 status 分组展示一次徽章,避免重复(用户诉求)。
  // 顺序沿用 STATUS_ORDER(reading → ... → abandoned),保证可预测。
  const firstStatusForSeries = useMemo<Map<string, BookStatus> | null>(() => {
    if (!matchingSeriesIds) return null
    const out = new Map<string, BookStatus>()
    for (const status of STATUS_ORDER) {
      for (const s of seriesList) {
        if (!matchingSeriesIds.has(s.id)) continue
        if (out.has(s.id)) continue
        const members = booksBySeriesId.get(s.id) ?? []
        if (members.some((b) => b.status === status)) {
          out.set(s.id, status)
        }
      }
    }
    return out
  }, [matchingSeriesIds, seriesList, booksBySeriesId])

  // v2.x worksFilter 对 series 的过滤:worksFilter !== 'all' 时,只展示「至少有一本 book.kind
  // 符合 worksFilter 的成员」的 series —— 用户筛「只看动画」时不关心系列的电影/小说成员。
  const seriesAllowedByKind = useMemo<Set<string>>(() => {
    if (worksFilter === 'all') {
      return new Set(seriesList.map((s) => s.id))
    }
    const out = new Set<string>()
    for (const s of seriesList) {
      const members = booksBySeriesId.get(s.id) ?? []
      if (members.some((b) => b.kind === worksFilter)) out.add(s.id)
    }
    return out
  }, [worksFilter, seriesList, booksBySeriesId])

  // v2.x 派生:每个 status 分组顶部应展示的 series 列表。
  // - 必须至少有 1 本 book.status === status(series 在该 status 有成员)
  // - 必须通过 worksFilter 过滤
  // - 搜索模式下:还要求 matchingSeriesIds 且 firstStatusForSeries === 当前 status(去重)
  // 按系列名 localeCompare('zh') 升序,跨 status 间保持一致的排序。
  const seriesByStatus = useMemo<Record<BookStatus, Series[]>>(() => {
    const out = {} as Record<BookStatus, Series[]>
    for (const status of STATUS_ORDER) {
      out[status] = seriesList
        .filter((s) => {
          if (!seriesAllowedByKind.has(s.id)) return false
          const members = booksBySeriesId.get(s.id) ?? []
          if (!members.some((b) => b.status === status)) return false
          if (matchingSeriesIds !== null) {
            if (!matchingSeriesIds.has(s.id)) return false
            if (firstStatusForSeries?.get(s.id) !== status) return false
          }
          return true
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    }
    return out
  }, [seriesList, booksBySeriesId, seriesAllowedByKind, matchingSeriesIds, firstStatusForSeries])

  // 每个 status 分组里的 book 项(被 series / search / worksFilter / collapsed 四重过滤)
  // - **series**:已归入某系列的书**不直接显示**在 status 分组(用户诉求"笨蛋测验召唤兽
  //   里好几个条目已经被收到系列里面了,这种条目不用在编辑模式中直接出现,而是之后通过
  //   点击系列后进入")。这种书只在 series 视图(SidebarSeriesView)出现。
  //   CleanMode 不受影响 —— useGroupedByStatus 直接拿全量,跟编辑模式"可见性"独立。
  // - **search**:模糊匹配 title / author / id。
  // - **worksFilter**:仅 kind 过滤;`all` 时全显。
  // - **collapsed**:已收起的书不进当前 status 分组,改去底部「已收起」bucket。
  const filteredByStatus = useMemo<Record<BookStatus, Book[]>>(() => {
    const out = {} as Record<BookStatus, Book[]>
    for (const status of STATUS_ORDER) {
      out[status] = groups[status]
        .filter((b) => !b.seriesId)
        .filter((b) => matchBook(b, query))
        .filter((b) => worksFilter === 'all' || b.kind === worksFilter)
        .filter((b) => !b.collapsed)
    }
    return out
  }, [groups, query, worksFilter])

  // status 分组 header 的 (N) / (N/M) 计数 —— 跟 filteredByStatus 同步(不含 seriesId +
  // collapsed + worksFilter),只不算 query。这样 query 模式 "(matched/visible)" 一致,
  // 无 query 模式 (visible) = 该分组实际可见数。
  const visibleByStatus = useMemo<Record<BookStatus, number>>(() => {
    const out = {} as Record<BookStatus, number>
    for (const status of STATUS_ORDER) {
      out[status] = groups[status]
        .filter((b) => !b.seriesId)
        .filter((b) => !b.collapsed)
        .filter((b) => worksFilter === 'all' || b.kind === worksFilter).length
    }
    return out
  }, [groups, worksFilter])

  // 编辑模式侧栏"已收起"分组:跨 status 收集所有 collapsed=true 的作品。
  // 同时排除已归系列的书(归入系列 = 完全从编辑模式消失,跟 collapsed 语义叠加冗余)——
  // 已在 series 视图暴露,这里再展示反而干扰。
  const collapsedItems = useMemo<Book[]>(
    () =>
      groups.reading
        .concat(groups.watching, groups.want, groups.finished, groups.shelved, groups.abandoned)
        .filter((b) => b.collapsed)
        .filter((b) => !b.seriesId),
    [groups]
  )

  // v2.x:点 series 徽章 → 切到 series 视图;再点 ← 返回 → 回到正常 status 分组
  function handleSeriesClick(seriesId: string): void {
    setSelectedSeriesId(seriesId)
    setRemovingMemberId(null)
  }
  function handleBackToList(): void {
    setSelectedSeriesId(null)
    setRemovingMemberId(null)
  }
  async function handleRemoveMember(bookId: string, bookTitle: string): Promise<void> {
    setRemovingMemberId(bookId)
    try {
      await setSeries(bookId, null)
    } catch (e) {
      alert(`移除失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRemovingMemberId(null)
    }
  }

  // v2.x:如果选了 series,整左侧栏切到 series 视图(覆盖 status 分组 + 已收起 bucket)。
  // 系列被删的脏引用兜底:selectedSeries === undefined → 自动清 selectedSeriesId 回 null。
  if (selectedSeriesId !== null) {
    const selectedSeries = seriesList.find((s) => s.id === selectedSeriesId)
    if (selectedSeries) {
      return (
        <SidebarSeriesView
          series={selectedSeries}
          books={books}
          onBack={handleBackToList}
          onSelectBook={(id) => {
            select(id)
            // 选 book 进 BookDetail —— 切走后清 series 视图态,避免下次回 EditMode 还卡在 series 视图
            setSelectedSeriesId(null)
            setRemovingMemberId(null)
          }}
          onRemoveMember={handleRemoveMember}
          removingId={removingMemberId}
        />
      )
    }
    setSelectedSeriesId(null)
  }

  return (
    <div className="book-list">
      {STATUS_ORDER.map((status) => {
        const items = filteredByStatus[status]
        const totalCount = visibleByStatus[status]
        const sectionKey = `status:${status}`
        const collapsed = isCollapsed(sectionKey)
        const seriesInThisStatus = seriesByStatus[status]
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
            {!collapsed && (
              <ul className={format === 'grid' ? 'book-grid' : undefined}>
                {/* 系列 row —— 跟 book row 渲染在同一个 <ul>,完全复用 .book-list-group li 的样式
                    (padding / hover / selected 反馈),仅通过 .kind-tag.kind-series 配色区分。
                    一个 status 分组里如果有 N 个系列 → N 个 li 各自占一行,跟其他条目一模一样。 */}
                {seriesInThisStatus.map((s) => (
                  <SeriesRowInSidebar
                    key={s.id}
                    series={s}
                    memberCount={booksBySeriesId.get(s.id)?.length ?? 0}
                    expanded={false}
                    onClick={handleSeriesClick}
                  />
                ))}
                {items.map((b) => (
                  <ItemRow
                    key={b.id}
                    b={b}
                    selected={selectedId === b.id}
                    onSelect={select}
                  />
                ))}
                {seriesInThisStatus.length === 0 && items.length === 0 && (
                  <li className="empty-hint muted">{query ? '— 无匹配 —' : '—'}</li>
                )}
              </ul>
            )}
          </section>
        )
      })}

      {/* 编辑模式"已收起"分组:跨 status 收集 collapsed=true 的作品,按 status 再拆子分组(每子分组
          独立可折叠)。不影响 CleanMode 任何行为(仍按 status 分组)。 */}
      <CollapsedBucket
        collapsedItems={collapsedItems}
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