// apps/life-tracker/src/renderer/components/GraphView.tsx
//
// 目标领域 GraphView —— 共享 GraphView 的 life-tracker 包装。
//
// 物理 / 布局 / 交互 / 居中 / 尺寸 / canvas 装饰全部下沉到
// packages/tracker-ui 的 GraphView。这里只剩领域差异：
//   - 节点 status → 颜色映射（STATUS_COLORS）
//   - 节点 hover 文案
//   - 解锁状态色（unlocked=false 灰 / highlight 蓝 / analyze 模式重写）
//   - analyze 模式：critical path 橙、bottleneck 红描边、orphan 灰
//   - analyze 模式边：critical path 橙色 + 加粗
//   - 图例 chips（status + 布局模式切换 + analyze 模式额外图例）
//   - useMemo 拆 specs / 算 unlock / 算 analyze 标记
//   - renderNodeDecoration：analyze 模式下画瓶颈/关键路径描边

import { useMemo, useState } from 'react'
import {
  GraphView as GraphCanvas,
  type BaseGraphNode,
  type BaseGraphLink,
  useGraphFilters,
  tagColor,
  ColorPicker,
  type ColorBy,
  type ContextMenuItem,
  type SidebarGroup
} from '@ui/GraphView'
import { analyzeGraph, computeUnlocked, groupMemberId } from '@core'
import { buildDonePredicate } from '@shared/done'
import type { Edge, GoalStatus, PrereqSpec } from '@shared/types'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'

const ANALYZE_COLORS = {
  critical: '#ff8800',
  bottleneck: '#d63031',
  orphan: '#999999'
} as const

const STATUS_COLORS: Record<GoalStatus, string> = {
  not_started: '#999999',
  in_progress: '#4a7c59',
  done: '#2d5a3a',
  shelved: '#c89456',
  abandoned: '#c0573d'
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

interface GoalNode extends BaseGraphNode {
  title: string
  category: string
  status: GoalStatus
  unlocked: boolean
  /** analyze mode 标记 */
  isInCriticalPath?: boolean
  isBottleneck?: boolean
  isOrphan?: boolean
}

interface GraphLink extends BaseGraphLink {
  source: string | GoalNode
  target: string | GoalNode
  rule: 'all' | 'any_of'
  threshold?: number
  /** analyze mode 标记：critical path 上的边 */
  isInCriticalPath?: boolean
}

/**
 * 把一条 edge 拆成 GraphLink 数组。与 computeUnlocked 的优先级对齐：
 *   1) `edge.specs` 含正向 spec（排除 exclude）→ 按 specs 拆边；
 *   2) 否则 `edge.groups` 非空 → mandatory prereqs（不在任何 group 里）+ 各 group member；
 *   3) 否则纯旧数据 → `edge.prerequisites` 直读。
 *
 * 任何字段都不要直读 `edge.prerequisites` 画图——specs 路径下它可能含
 * 「旧裸 id 兜底」遗留（见 PrereqEditor.persist §5），按它画会多出废边。
 *
 * 最后做一次 `(source, target)` 去重：
 *   - countable 任务常被多次添加为 `simple` spec（每次 count 不同）。旧实现按 specs 1:1
 *     画边——同一 source→target 出现 N 条平行边。
 *   - 旧 AND-of-ORs 路径下，同一 id 出现在多个 groups / `count`/`group` spec 里也会堆积。
 *
 * 过滤悬空引用：source / target 不在 `validIds` 里的 link 直接丢弃。
 */
function deriveLinks(edge: Edge, validIds: Set<string>): GraphLink[] {
  const mkLink = (source: string): GraphLink | null => {
    if (!validIds.has(source) || !validIds.has(edge.to)) return null
    return {
      source,
      target: edge.to,
      rule: edge.rule,
      threshold: edge.threshold
    }
  }
  const specs: PrereqSpec[] = edge.specs ?? []
  const positiveSpecs = specs.filter((s) => s.kind !== 'exclude')

  const collected: GraphLink[] = []
  if (positiveSpecs.length > 0) {
    for (const s of positiveSpecs) {
      if (s.kind === 'simple') {
        const l = mkLink(s.id)
        if (l) collected.push(l)
      } else if (s.kind === 'group') {
        for (const m of s.members) {
          const l = mkLink(groupMemberId(m))
          if (l) collected.push(l)
        }
      } else if (s.kind === 'count') {
        for (const id of s.members) {
          const l = mkLink(id)
          if (l) collected.push(l)
        }
      }
      // exclude 不画边（谓词改写已在 isDone 层处理）
    }
  } else if (edge.groups && edge.groups.length > 0) {
    const inGroup = new Set<string>(edge.groups.flat())
    for (const p of edge.prerequisites) {
      if (inGroup.has(p)) continue
      const l = mkLink(p)
      if (l) collected.push(l)
    }
    for (const g of edge.groups) {
      for (const id of g) {
        const l = mkLink(id)
        if (l) collected.push(l)
      }
    }
  } else {
    for (const p of edge.prerequisites) {
      const l = mkLink(p)
      if (l) collected.push(l)
    }
  }

  const seen = new Set<string>()
  return collected.filter((l) => {
    const key = `${l.source}->${edge.to}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

interface GraphViewProps {
  highlightId?: string | null
}

const STATUS_ORDER: GoalStatus[] = ['done', 'in_progress', 'not_started', 'shelved', 'abandoned']

export function GraphView({ highlightId }: GraphViewProps): JSX.Element {
  const [layoutMode, setLayoutMode] = useState<'force' | 'tree' | 'analyze'>('force')
  const [showForceParams, setShowForceParams] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [colorBy, setColorBy] = useState<ColorBy>('status')
  const { filters, setFilters, resetFilters } = useGraphFilters({
    storageKey: 'life-tracker-graph-filters'
  })
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const select = useGoalsStore((s) => s.select)
  const removeGoal = useGoalsStore((s) => s.remove)

  /* life 没有 tag 字段，用 category 当 filter "tag" 维度 */
  const availableTags = useMemo(() => {
    const set = new Set<string>()
    for (const g of goals) {
      if (g.category) set.add(g.category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [goals])

  const availableStatuses = [
    { value: 'not_started', label: '未开始', color: STATUS_COLORS.not_started },
    { value: 'in_progress', label: '进行中', color: STATUS_COLORS.in_progress },
    { value: 'done', label: '已达成', color: STATUS_COLORS.done },
    { value: 'shelved', label: '搁置', color: STATUS_COLORS.shelved },
    { value: 'abandoned', label: '放弃', color: STATUS_COLORS.abandoned }
  ]

  const data = useMemo(() => {
    const goalIds = new Set(goals.map((g) => g.id))
    const links: GraphLink[] = []
    const refCount = new Map<string, number>()
    for (const g of goals) refCount.set(g.id, 0)
    for (const e of edges) {
      const ls = deriveLinks(e, goalIds)
      for (const l of ls) {
        const sid = typeof l.source === 'string' ? l.source : (l.source as GoalNode).id
        refCount.set(sid, (refCount.get(sid) ?? 0) + 1)
      }
      links.push(...ls)
    }

    // buildDonePredicate 含互斥规则（exclude）+ countable 引用次数，
    // 与 PrereqEditor / CleanMode 语义一致。
    const { isDone } = buildDonePredicate(goals, edges)
    const { unlocked } = computeUnlocked(
      goals.map((g) => g.id),
      edges,
      isDone
    )

    // analyze mode 标记：跑一遍 analyzeGraph，提取 criticalPath / bottlenecks / orphans
    const analysis = analyzeGraph(goals.map((g) => g.id), edges, isDone)
    const criticalPathSet = new Set(analysis.criticalPath)
    const bottleneckSet = new Set(analysis.bottlenecks.map((b) => b.id))
    const orphanSet = new Set(analysis.orphans)
    const pathEdgeSet = new Set<string>()
    for (let i = 0; i < analysis.criticalPath.length - 1; i++) {
      pathEdgeSet.add(`${analysis.criticalPath[i]}->${analysis.criticalPath[i + 1]}`)
    }

    const nodes: GoalNode[] = goals.map((g) => ({
      id: g.id,
      title: g.title,
      category: g.category,
      status: g.status,
      refCount: refCount.get(g.id) ?? 0,
      unlocked: unlocked.get(g.id) ?? true,
      isInCriticalPath: criticalPathSet.has(g.id),
      isBottleneck: bottleneckSet.has(g.id),
      isOrphan: orphanSet.has(g.id)
    }))

    const annotatedLinks: GraphLink[] = links.map((l) => {
      const sid = typeof l.source === 'string' ? l.source : (l.source as GoalNode).id
      const tid = typeof l.target === 'string' ? l.target : (l.target as GoalNode).id
      return { ...l, isInCriticalPath: pathEdgeSet.has(`${sid}->${tid}`) }
    })

    return { nodes, links: annotatedLinks }
  }, [goals, edges])

  const maxRefCount = useMemo(() => {
    let max = 0
    for (const n of data.nodes) if (n.refCount > max) max = n.refCount
    return max
  }, [data.nodes])

  /* 节点列表侧栏 —— 按 status 分组 + 标题字母序 */
  const sidebarGroups = useMemo<SidebarGroup[]>(() => {
    const buckets = new Map<GoalStatus, GoalNode[]>()
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
        label: STATUS_LABEL[status],
        items: items.map((n) => ({ id: n.id, title: n.title, color: STATUS_COLORS[n.status] }))
      })
    }
    return groups
  }, [data.nodes])

  return (
    <GraphCanvas<GoalNode, GraphLink>
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
      getNodeSearchText={(n) => `${n.id} ${n.title} ${n.category}`}
      filters={filters}
      setFilters={setFilters}
      resetFilters={resetFilters}
      availableTags={availableTags}
      availableStatuses={availableStatuses}
      maxRefCount={maxRefCount}
      getNodeTagsForFilter={(n) => [n.category]}
      getNodeStatusForFilter={(n) => n.status}
      emptyText="还没有目标。加几个试试。"
      getNodeColor={(n) => {
        // analyze mode：孤立灰、关键路径橙、其他维持 status 颜色；highlight 蓝色优先
        if (layoutMode === 'analyze') {
          if (highlightId && n.id === highlightId) return '#3b6cf2'
          if (n.isOrphan) return ANALYZE_COLORS.orphan
          if (n.isInCriticalPath) return ANALYZE_COLORS.critical
          return STATUS_COLORS[n.status]
        }
        if (highlightId && n.id === highlightId) return '#3b6cf2'
        if (colorBy === 'unlock') {
          return n.unlocked ? STATUS_COLORS[n.status] : '#c8c8c8'
        }
        if (colorBy === 'category') {
          return n.category ? tagColor(n.category) : '#c8c8c8'
        }
        /* status（默认）*/
        if (!n.unlocked) return '#c8c8c8'
        return STATUS_COLORS[n.status]
      }}
      getNodeLabel={(n) => `${n.title} (${STATUS_LABEL[n.status]})`}
      getLinkColor={(l, ctx) => {
        // analyze mode：critical path 上的边用橙色
        if (layoutMode === 'analyze' && l.isInCriticalPath) return ANALYZE_COLORS.critical
        if (ctx.sourceUnlocked && ctx.targetUnlocked) return '#cccccc'
        return '#e8c0c0'
      }}
      getLinkWidth={(l) => {
        if (layoutMode === 'analyze' && l.isInCriticalPath) return 3
        return 1
      }}
      renderNodeDecoration={
        layoutMode === 'analyze'
          ? ({ node, ctx, scale, nodeSize }) => {
              if (scale < 0.6) return
              if (node.isBottleneck) {
                ctx.beginPath()
                ctx.arc(node.x!, node.y!, nodeSize + 4, 0, 2 * Math.PI)
                ctx.strokeStyle = ANALYZE_COLORS.bottleneck
                ctx.lineWidth = 3
                ctx.stroke()
              } else if (node.isInCriticalPath) {
                ctx.beginPath()
                ctx.arc(node.x!, node.y!, nodeSize + 3, 0, 2 * Math.PI)
                ctx.strokeStyle = ANALYZE_COLORS.critical
                ctx.lineWidth = 2
                ctx.stroke()
              }
            }
          : undefined
      }
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
              void removeGoal(n.id)
              select(null)
            }
          }
        }
      ]}
      legend={
        <>
          {layoutMode !== 'analyze' && colorBy === 'category' ? (
            /* category 模式：前 5 个 category + "无类别" */
            <>
              {availableTags.slice(0, 5).map((c) => (
                <span key={c}>
                  <span className="lg-dot" style={{ background: tagColor(c) }} />
                  {c}
                </span>
              ))}
              <span className="lg-sep" />
              <span className="lg-dot" style={{ background: '#c8c8c8' }} />无类别
            </>
          ) : layoutMode !== 'analyze' && (
            <>
              <span className="lg-dot" style={{ background: STATUS_COLORS.not_started }} />未开始
              <span className="lg-dot" style={{ background: STATUS_COLORS.in_progress }} />进行中
              <span className="lg-dot" style={{ background: STATUS_COLORS.done }} />已达成
              <span className="lg-dot" style={{ background: STATUS_COLORS.shelved }} />搁置
              <span className="lg-dot" style={{ background: STATUS_COLORS.abandoned }} />放弃
              {colorBy === 'status' && (
                <>
                  <span className="lg-sep" />
                  <span className="lg-dot" style={{ background: '#c8c8c8' }} />未解锁
                </>
              )}
            </>
          )}
          {layoutMode !== 'analyze' && (
            <>
              <span className="lg-sep" />
              <ColorPicker
                value={colorBy}
                onChange={setColorBy}
                options={[
                  { value: 'status', label: '状态', hint: '按 5 种状态着色' },
                  { value: 'category', label: '类别', hint: '按 goal.category 哈希着色' },
                  { value: 'unlock', label: '解锁', hint: '解锁=状态色 / 未解锁=灰' }
                ]}
              />
            </>
          )}
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
          <button
            type="button"
            className={'lg-toggle' + (layoutMode === 'analyze' ? ' active' : '')}
            onClick={() => setLayoutMode('analyze')}
            title="分析模式：橙色=关键路径，红色描边=瓶颈，灰色=孤立"
          >
            分析
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
            title="过滤：按类别 / 状态 / 入度阈值 / 孤立节点筛选"
            aria-label="过滤"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          <button
            type="button"
            className={'lg-toggle' + (sidebarOpen ? ' active' : '')}
            onClick={() => setSidebarOpen((v) => !v)}
            title="节点列表侧栏"
            aria-label="节点列表"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          {layoutMode === 'analyze' && (
            <>
              <span className="lg-sep" />
              <span
                className="lg-dot"
                style={{ background: ANALYZE_COLORS.critical, border: '1px solid #cc6600' }}
              />
              关键路径
              <span
                className="lg-dot"
                style={{ border: `2px solid ${ANALYZE_COLORS.bottleneck}`, background: 'transparent' }}
              />
              瓶颈
              <span className="lg-dot" style={{ background: ANALYZE_COLORS.orphan }} />
              孤立
            </>
          )}
        </>
      }
    />
  )
}