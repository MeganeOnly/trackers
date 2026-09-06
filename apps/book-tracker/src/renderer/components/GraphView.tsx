// apps/book-tracker/src/renderer/components/GraphView.tsx
//
// 书籍领域 GraphView —— 共享 GraphView 的 book-tracker 包装。
//
// 物理 / 布局 / 交互 / 居中 / 尺寸 / tag chip 渲染全部下沉到
// packages/tracker-ui 的 GraphView。这里只剩领域差异：
//   - 节点 status → 颜色映射（STATUS_COLORS）
//   - 节点 hover 文案
//   - 解锁状态色（unlocked=false 灰 / highlight 蓝）
//   - 解锁边色（双方解锁=灰 / 否则偏红）
//   - 图例 chips（status + 布局模式切换）
//   - useMemo 拆 specs / 算 unlock / 算 refCount

import { useMemo, useState } from 'react'
import {
  GraphView as GraphCanvas,
  type BaseGraphNode,
  type BaseGraphLink,
  useGraphFilters,
  useGraphPath,
  tagColor,
  ColorPicker,
  type ColorBy,
  type ContextMenuItem,
  type SidebarGroup,
  type PathEndpoints
} from '@ui/GraphView'
import { computeUnlocked } from '@core'
import type { Book, BookStatus } from '@shared/types'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { STATUS_LABELS } from './BookDetail.labels'

const STATUS_COLORS: Record<BookStatus, string> = {
  want: '#999999',
  shelved: '#c89456',
  reading: '#4a7c59',
  watching: '#5a8a6c', // 比 reading 略浅一档；同属「进行中」色族
  finished: '#2d5a3a',
  abandoned: '#c0573d'
}

interface BookNode extends BaseGraphNode {
  title: string
  author: string
  status: BookStatus
  unlocked: boolean
  tags: string[]
}

interface GraphLink extends BaseGraphLink {
  source: string | BookNode
  target: string | BookNode
  rule: 'all' | 'any_of'
  threshold?: number
}

/**
 * 计算每个节点的"下游"（我作为前置指向的节点）：
 *   - 收集所有 link 的 (source, target) 对
 *   - book 路径没有 specs / groups（只有 `prerequisites`），所以简单 forEach 即可
 *
 * 用于路径跟踪（A→B 沿 unlock 方向）。
 */
function buildForwardMap(links: { source: string; target: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const l of links) {
    const arr = map.get(l.source) ?? []
    arr.push(l.target)
    map.set(l.source, arr)
  }
  return map
}

interface GraphViewProps {
  highlightId?: string | null
}

const STATUS_ORDER: BookStatus[] = [
  'finished',
  'watching',
  'reading',
  'want',
  'shelved',
  'abandoned'
]

export function GraphView({ highlightId }: GraphViewProps): JSX.Element {
  const [layoutMode, setLayoutMode] = useState<'force' | 'tree' | 'analyze'>('force')
  const [showForceParams, setShowForceParams] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [colorBy, setColorBy] = useState<ColorBy>('status')
  const [pathMode, setPathMode] = useState(false)
  const [pathEndpoints, setPathEndpoints] = useState<PathEndpoints>({ a: null, b: null })
  const { filters, setFilters, resetFilters } = useGraphFilters({
    storageKey: 'book-tracker-graph-filters'
  })
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  const select = useBooksStore((s) => s.select)
  const removeBook = useBooksStore((s) => s.remove)

  /* 从 books 中提取 availableTags */
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const b of books) {
      for (const t of b.tags ?? []) tagSet.add(t)
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b))
  }, [books])

  const availableStatuses = [
    { value: 'want', label: '想看', color: STATUS_COLORS.want },
    { value: 'reading', label: '在读', color: STATUS_COLORS.reading },
    { value: 'watching', label: '在看', color: STATUS_COLORS.watching },
    { value: 'finished', label: '已读', color: STATUS_COLORS.finished },
    { value: 'shelved', label: '搁置', color: STATUS_COLORS.shelved },
    { value: 'abandoned', label: '弃读', color: STATUS_COLORS.abandoned }
  ]

  const data = useMemo(() => {
    const bookIds = new Set(books.map((b) => b.id))
    const refCount = new Map<string, number>()
    for (const b of books) refCount.set(b.id, 0)
    for (const e of edges) {
      for (const p of e.prerequisites) {
        if (!bookIds.has(p) || !bookIds.has(e.to)) continue
        refCount.set(p, (refCount.get(p) ?? 0) + 1)
      }
    }
    const { unlocked } = computeUnlocked(
      books.map((b) => b.id),
      edges,
      (id) => books.some((b) => b.id === id && b.status === 'finished')
    )
    const nodes: BookNode[] = books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      status: b.status,
      refCount: refCount.get(b.id) ?? 0,
      unlocked: unlocked.get(b.id) ?? true,
      tags: b.tags ?? []
    }))
    const links: GraphLink[] = edges.flatMap((e) =>
      e.prerequisites
        .filter((p) => bookIds.has(p) && bookIds.has(e.to))
        .map((p) => ({
          source: p,
          target: e.to,
          rule: e.rule,
          threshold: e.threshold
        }))
    )
    return { nodes, links }
  }, [books, edges])

  /* 下游映射 —— 给路径 BFS 用 */
  const forwardMap = useMemo(() => {
    return buildForwardMap(
      data.links.map((l) => ({
        source: typeof l.source === 'string' ? l.source : l.source.id,
        target: typeof l.target === 'string' ? l.target : l.target.id
      }))
    )
  }, [data.links])
  const getNodeForward = useMemo(
    () => (id: string): string[] => forwardMap.get(id) ?? [],
    [forwardMap]
  )

  const maxRefCount = useMemo(() => {
    let max = 0
    for (const n of data.nodes) if (n.refCount > max) max = n.refCount
    return max
  }, [data.nodes])

  /* 节点列表侧栏 —— 按 status 分组 + 标题字母序 */
  const sidebarGroups = useMemo<SidebarGroup[]>(() => {
    const buckets = new Map<BookStatus, BookNode[]>()
    for (const n of data.nodes) {
      const arr = buckets.get(n.status)
      if (arr) arr.push(n)
      else buckets.set(n.status, [n])
    }
    const groups: SidebarGroup[] = []
    for (const status of STATUS_ORDER) {
      const items = buckets.get(status)
      if (!items || items.length === 0) continue
      items.sort((a, b) => a.title.localeCompare(b.title))
      groups.push({
        id: status,
        label: STATUS_LABELS[status],
        items: items.map((n) => ({ id: n.id, title: n.title, color: STATUS_COLORS[n.status] }))
      })
    }
    return groups
  }, [data.nodes])

  return (
    <GraphCanvas<BookNode>
      data={data}
      layoutMode={layoutMode}
      highlightId={highlightId}
      showForceParams={showForceParams}
      onForceParamsClose={() => setShowForceParams(false)}
      showFilters={showFilters}
      onFiltersClose={() => setShowFilters(false)}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={() => setSidebarOpen((v) => !v)}
      sidebarGroups={sidebarGroups}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      getNodeSearchText={(n) => `${n.id} ${n.title} ${(n.tags ?? []).join(' ')}`}
      filters={filters}
      setFilters={setFilters}
      resetFilters={resetFilters}
      availableTags={availableTags}
      availableStatuses={availableStatuses}
      maxRefCount={maxRefCount}
      getNodeTagsForFilter={(n) => n.tags}
      getNodeStatusForFilter={(n) => n.status}
      emptyText="还没有作品。加几部试试。"
      getNodeColor={(n) => {
        if (highlightId && n.id === highlightId) return '#3b6cf2'
        if (colorBy === 'unlock') {
          return n.unlocked ? STATUS_COLORS[n.status] : '#c8c8c8'
        }
        if (colorBy === 'tag') {
          const firstTag = n.tags?.[0]
          return firstTag ? tagColor(firstTag) : '#c8c8c8'
        }
        /* status（默认）*/
        if (!n.unlocked) return '#c8c8c8'
        return STATUS_COLORS[n.status]
      }}
      getNodeLabel={(n) => `${n.title} (${STATUS_LABELS[n.status]})`}
      getNodeTags={(n) => n.tags}
      onSelect={(id) => {
        if (pathMode) {
          if (!pathEndpoints.a) {
            setPathEndpoints({ a: id, b: null })
          } else if (!pathEndpoints.b) {
            setPathEndpoints({ ...pathEndpoints, b: id })
            setPathMode(false)
          } else {
            setPathEndpoints({ a: id, b: null })
          }
        } else {
          select(id)
        }
      }}
      pathEndpoints={pathEndpoints}
      setPathEndpoints={setPathEndpoints}
      getNodeForward={getNodeForward}
      contextMenuItems={(n): ContextMenuItem[] => [
        {
          id: 'open',
          label: '打开',
          onSelect: () => select(n.id)
        },
        {
          id: 'delete',
          label: '删除',
          danger: true,
          onSelect: () => {
            const title = (n as unknown as { title: string }).title
            if (window.confirm(`确定删除「${title}」？该操作会同时移除所有以它为前置的边。`)) {
              void removeBook(n.id)
              select(null)
            }
          }
        }
      ]}
      legend={
        <>
          {colorBy === 'tag' ? (
            /* tag 模式：前几个 tag + "无 tag" */
            <>
              {availableTags.slice(0, 5).map((t) => (
                <span key={t}>
                  <span className="lg-dot" style={{ background: tagColor(t) }} />
                  {t}
                </span>
              ))}
              <span className="lg-sep" />
              <span className="lg-dot" style={{ background: '#c8c8c8' }} />无 tag
            </>
          ) : (
            <>
              <span className="lg-dot" style={{ background: STATUS_COLORS.want }} />想看
              <span className="lg-dot" style={{ background: STATUS_COLORS.reading }} />在读
              <span className="lg-dot" style={{ background: STATUS_COLORS.watching }} />在看
              <span className="lg-dot" style={{ background: STATUS_COLORS.finished }} />已读
              <span className="lg-dot" style={{ background: STATUS_COLORS.shelved }} />搁置
              <span className="lg-dot" style={{ background: STATUS_COLORS.abandoned }} />弃读
              {colorBy === 'status' && (
                <>
                  <span className="lg-sep" />
                  <span className="lg-dot" style={{ background: '#c8c8c8' }} />未解锁
                </>
              )}
            </>
          )}
          <span className="lg-sep" />
          <ColorPicker
            value={colorBy}
            onChange={setColorBy}
            options={[
              { value: 'status', label: '状态', hint: '按 6 种状态着色' },
              { value: 'tag', label: '标签', hint: '按第一个 tag 哈希着色' },
              { value: 'unlock', label: '解锁', hint: '解锁=状态色 / 未解锁=灰' }
            ]}
          />
          <span className="lg-sep" />
          <button
            type="button"
            className={'lg-toggle' + (layoutMode === 'force' ? ' active' : '')}
            onClick={() => setLayoutMode('force')}
            title="力导向布局：节点绕中心旋转，关系自由"
          >
            力导向
          </button>
          <button
            type="button"
            className={'lg-toggle' + (layoutMode === 'tree' ? ' active' : '')}
            onClick={() => setLayoutMode('tree')}
            title="层级布局：底部叶子 → 顶部总目标，位置固定"
          >
            层级
          </button>
          <span className="lg-sep" />
          <button
            type="button"
            className={'lg-toggle lg-toggle--icon' + (showForceParams ? ' active' : '')}
            onClick={() => setShowForceParams((v) => !v)}
            title="力参数：实时调节轨道力 / 抖动 / 向心 / 电荷斥力"
            aria-label="力参数"
            aria-pressed={showForceParams}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            className={'lg-toggle lg-toggle--icon' + (showFilters ? ' active' : '')}
            onClick={() => setShowFilters((v) => !v)}
            title="过滤：按标签 / 状态 / 入度阈值 / 孤立节点筛选"
            aria-label="过滤"
            aria-pressed={showFilters}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          <button
            type="button"
            className={'lg-toggle lg-toggle--icon' + (sidebarOpen ? ' active' : '')}
            onClick={() => setSidebarOpen((v) => !v)}
            title="节点列表侧栏"
            aria-label="节点列表"
            aria-pressed={sidebarOpen}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <circle cx="3.5" cy="6" r="0.6" />
              <circle cx="3.5" cy="12" r="0.6" />
              <circle cx="3.5" cy="18" r="0.6" />
            </svg>
          </button>
          <button
            type="button"
            className={'lg-toggle lg-toggle--icon' + (pathMode ? ' active' : '') + (pathEndpoints.a ? ' active' : '')}
            onClick={() => {
              if (pathEndpoints.a || pathEndpoints.b) {
                /* 已设了 A/B → 清掉 */
                setPathEndpoints({ a: null, b: null })
                setPathMode(false)
              } else {
                setPathMode((v) => !v)
              }
            }}
            title={
              pathEndpoints.a
                ? `已选起点 ${pathEndpoints.a}，点节点设终点`
                : pathMode
                  ? '点节点设为路径起点'
                  : '路径跟踪：依次选起点和终点，BFS 最短路径高亮'
            }
            aria-label="路径"
            aria-pressed={pathMode || !!pathEndpoints.a}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="18" cy="18" r="2.5" />
              <path d="M8 7l8 8" />
            </svg>
          </button>
        </>
      }
    />
  )
}