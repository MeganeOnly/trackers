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
  tagColor,
  ColorPicker,
  type ColorBy,
  type ContextMenuItem
} from '@ui/GraphView'
import { computeUnlocked } from '@core'
import type { Book, BookStatus } from '@shared/types'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'

const STATUS_COLORS: Record<BookStatus, string> = {
  want: '#999999',
  shelved: '#c89456',
  reading: '#4a7c59',
  watching: '#5a8a6c', // 比 reading 略浅一档；同属「进行中」色族
  finished: '#2d5a3a',
  abandoned: '#c0573d'
}

const STATUS_LABEL: Record<BookStatus, string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  watching: '在看',
  finished: '已读',
  abandoned: '弃读'
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

interface GraphViewProps {
  highlightId?: string | null
}

export function GraphView({ highlightId }: GraphViewProps): JSX.Element {
  const [layoutMode, setLayoutMode] = useState<'force' | 'tree' | 'analyze'>('force')
  const [showForceParams, setShowForceParams] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [colorBy, setColorBy] = useState<ColorBy>('status')
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

  /* 入度阈值上限 = 节点中 refCount 最大值 */
  const maxRefCount = useMemo(() => {
    let max = 0
    for (const n of data.nodes) if (n.refCount > max) max = n.refCount
    return max
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
      getNodeLabel={(n) => `${n.title} (${STATUS_LABEL[n.status]})`}
      getNodeTags={(n) => n.tags}
      onSelect={(id) => select(id)}
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
            className={'lg-toggle' + (showForceParams ? ' active' : '')}
            onClick={() => setShowForceParams((v) => !v)}
            title="力参数：实时调节轨道力 / 抖动 / 向心 / 电荷斥力"
            aria-label="力参数"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            className={'lg-toggle' + (showFilters ? ' active' : '')}
            onClick={() => setShowFilters((v) => !v)}
            title="过滤：按标签 / 状态 / 入度阈值 / 孤立节点筛选"
            aria-label="过滤"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
        </>
      }
    />
  )
}