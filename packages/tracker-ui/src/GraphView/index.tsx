// packages/tracker-ui/src/GraphView/index.tsx
//
// 共享 GraphView —— 力导向 + 树形布局的物理 / 交互 / 居中 / 尺寸逻辑下沉到这里。
//
// 领域无关部分（两个 app 都一样）：
//   - d3-force orbit / jitter / centripetal + charge 强度
//   - pointerOver 自适应（hover 时图停住）
//   - computeDepths + applyTreeLayout（树形布局）
//   - 两段式居中（即时 + 模拟收敛后精确）
//   - ResizeObserver 自适应 wrap dims
//   - drawTagChips 工具（book-tracker 的 tags chip 渲染走这条路径）
//   - 节点大小公式（refCount → size）、边箭头 + 方向、未解锁边色等通用渲染
//   - layoutMode 切换（force / tree / analyze）的统一 effect
//   - 高亮节点钉位（force 模式钉中心；tree 模式不动层级位置）
//   - 图例容器（具体 chips 由 app 通过 legend prop 注入）
//
// 领域差异（app 通过 props 注入，共享层不感知）：
//   - layoutMode 由 app 端 useState 控制（共享层只在 effect 里响应）
//   - 节点色（status / analyze / 维度着色都通过 getNodeColor）
//   - 节点 hover 标签文案
//   - 节点附加装饰（life analyze 模式的瓶颈/关键路径描边走 renderNodeDecoration）
//   - 空状态文案
//   - 图例 chips（状态色 + 布局模式按钮由 app 拼好传入）
//
// 类型策略：
//   - props 用 N 泛型（callback 拿到 app 端节点类型），但内部 ForceGraph2D / d3-force
//     统一用 BaseGraphNode，callback cast 一次。
//   - 不穿透 ForceGraph2D 自己的 NodeObject<N> 包装（那是 react-force-graph 内部细节，
//     包装后 n 仍然满足 BaseGraphNode 形态），用 `as unknown as` 规避泛型爆炸。

import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { ReactNode } from 'react'
import type { BaseGraphNode, BaseGraphLink } from './types'
import { useResize } from './useResize'
import { useGraphPhysics } from './useGraphPhysics'
import {
  applyTreeLayout,
  computeDepths,
  DEFAULT_TREE_DIMS
} from './useTreeLayout'
import { useAutoCenter } from './useAutoCenter'
import { drawTagChips } from './drawTagChips'
import { ForceParamsPanel } from './ForceParamsPanel'
import { SearchBox } from './SearchBox'
import { FiltersPanel, type StatusOption } from './FiltersPanel'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { NodeSidebar, type SidebarGroup } from './NodeSidebar'
import type { GraphFilters } from './useGraphFilters'

/** 节点尺寸公式（force-graph nodeVal） —— 与原 GraphView 一致 */
const NODE_SIZE_FN = (n: BaseGraphNode): number => 1 + Math.sqrt(n.refCount) * 2

/** 节点附加装饰签名 —— 共享层在 nodeCanvasObject(mode='after') 末尾调 */
export type NodeDecorationFn<N extends BaseGraphNode = BaseGraphNode> = (args: {
  node: N
  ctx: CanvasRenderingContext2D
  scale: number
  /** 节点实际半径（按 refCount 计算） */
  nodeSize: number
}) => void

export type LayoutMode = 'force' | 'tree' | 'analyze'

export interface GraphViewProps<
  N extends BaseGraphNode = BaseGraphNode,
  L extends BaseGraphLink = BaseGraphLink
> {
  data: { nodes: N[]; links: L[] }
  /** 当前布局模式（app 端 useState） */
  layoutMode: LayoutMode
  /** 节点色（app 注入：可按 status / analyze / 维度切换） */
  getNodeColor: (node: N) => string
  /** 节点 hover tooltip 文案 */
  getNodeLabel: (node: N) => string
  /** 节点下方画 chip（book-tracker tags；其它 app 不传 = 不画） */
  getNodeTags?: (node: N) => string[]
  /** 节点附加装饰（life analyze 模式的描边等） */
  renderNodeDecoration?: NodeDecorationFn<N>
  /** link 色 —— 不传则按 source/target 解锁状态默认染色 */
  getLinkColor?: (link: L, ctx: { sourceUnlocked?: boolean; targetUnlocked?: boolean }) => string
  /** link 宽 —— 不传则固定 1 */
  getLinkWidth?: (link: L) => number
  /** 是否绘制节点标题 —— 默认 true */
  showNodeTitle?: boolean
  /** 是否显示力参数浮窗（commit 1）—— 默认 false */
  showForceParams?: boolean
  /** 关闭力参数浮窗的回调 */
  onForceParamsClose?: () => void
  /** 搜索框 query（commit 2）—— app 端 useState 管理；空 = 不渲染搜索框 */
  searchQuery?: string
  /** 设置 searchQuery 的回调 */
  setSearchQuery?: (q: string) => void
  /** 把节点拼成可搜索字符串（app 端决定包含 id / title / tag 等） */
  getNodeSearchText?: (node: N) => string
  /** 过滤面板（commit 3）—— 不传则不渲染面板；传了则按 filters 过滤节点 */
  filters?: GraphFilters
  setFilters?: (next: GraphFilters) => void
  resetFilters?: () => void
  /** app 端从数据提取的 tag 列表（用于面板 checkbox） */
  availableTags?: string[]
  /** app 端定义的 status 选项（value + label + color） */
  availableStatuses?: StatusOption[]
  /** 入度阈值上限（= max(refCount)） */
  maxRefCount?: number
  /** 是否显示过滤面板 */
  showFilters?: boolean
  /** 关闭过滤面板的回调 */
  onFiltersClose?: () => void
  /** app 端从节点取 tag 列表（用于面板可见性 + 过滤匹配） */
  getNodeTagsForFilter?: (node: N) => string[]
  /** app 端从节点取 status 字符串（用于过滤匹配） */
  getNodeStatusForFilter?: (node: N) => string
  /** 右键菜单项（commit 5）—— 不传则不响应右击 */
  contextMenuItems?: (node: N) => ContextMenuItem[]
  /** 节点列表侧栏（commit 6）—— 不传则不渲染 */
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  sidebarGroups?: SidebarGroup[]
  /** 高亮节点（force 模式钉中心 / tree 模式不动层级位置） */
  highlightId?: string | null
  /** 点击节点 */
  onSelect?: (id: string) => void
  /** 节点拖完 —— app 可干预（life analyze / book 默认行为） */
  onNodeDragEnd?: (node: N) => void
  /** 空数据时显示文案 */
  emptyText?: string
  /** 画布底色 */
  backgroundColor?: string
  /** 图例（左下角容器；具体 chips 由 app 拼好传入） */
  legend?: ReactNode
}

export function GraphView<
  N extends BaseGraphNode = BaseGraphNode,
  L extends BaseGraphLink = BaseGraphLink
>(
  props: GraphViewProps<N, L>
): JSX.Element {
  const {
    data,
    layoutMode: layoutModeProp,
    getNodeColor,
    getNodeLabel,
    getNodeTags,
    renderNodeDecoration,
    getLinkColor,
    getLinkWidth,
    showNodeTitle = true,
    showForceParams = false,
    onForceParamsClose,
    searchQuery,
    setSearchQuery,
    getNodeSearchText,
    filters,
    setFilters,
    resetFilters,
    availableTags = [],
    availableStatuses = [],
    maxRefCount = 0,
    showFilters = false,
    onFiltersClose,
    getNodeTagsForFilter,
    getNodeStatusForFilter,
    contextMenuItems,
    sidebarOpen = false,
    onSidebarToggle,
    sidebarGroups,
    highlightId,
    onSelect,
    onNodeDragEnd,
    emptyText = '还没有数据。',
    backgroundColor = '#fafaf8',
    legend
  } = props

  // 搜索匹配集合 —— commit 2：模糊匹配 id / title / tag
  const searchMatches = useMemo<Set<string> | null>(() => {
    if (!searchQuery || !getNodeSearchText) return null
    const q = searchQuery.trim().toLowerCase()
    if (q === '') return null
    const set = new Set<string>()
    for (const n of data.nodes) {
      if (getNodeSearchText(n as unknown as N).toLowerCase().includes(q)) {
        set.add(n.id)
      }
    }
    return set.size > 0 ? set : null /* null = 无匹配（与"未激活"语义区分） */
  }, [searchQuery, getNodeSearchText, data.nodes])

  const isSearchActive = searchMatches !== null
  const matchCount = searchMatches?.size ?? 0

  // 应用过滤面板（commit 3）：多维过滤后剩 visibleNodes
  const visibleNodes = useMemo(() => {
    if (!filters) return data.nodes
    return data.nodes.filter((n) => {
      const node = n as unknown as N
      if (!filters.showOrphans && n.refCount === 0) return false
      if (filters.minRefCount > 0 && n.refCount < filters.minRefCount) return false
      if (filters.tags.length > 0) {
        const nodeTags = getNodeTagsForFilter?.(node) ?? []
        if (!filters.tags.some((t) => nodeTags.includes(t))) return false
      }
      if (filters.statuses.length > 0) {
        const s = getNodeStatusForFilter?.(node) ?? ''
        if (!filters.statuses.includes(s)) return false
      }
      return true
    })
  }, [data.nodes, filters, getNodeTagsForFilter, getNodeStatusForFilter])

  /* 用过滤后的 visibleNodes 重组 links（剔除指向/来自隐藏节点的 link） */
  const visibleData = useMemo(() => {
    if (visibleNodes === data.nodes) return data
    const visibleIds = new Set(visibleNodes.map((n) => n.id))
    const links = data.links.filter((l) => {
      const sid = typeof l.source === 'string' ? l.source : l.source.id
      const tid = typeof l.target === 'string' ? l.target : l.target.id
      return visibleIds.has(sid) && visibleIds.has(tid)
    })
    return { nodes: visibleNodes, links }
  }, [visibleNodes, data])

  const isFiltering = !!filters
  const noVisibleNodes = visibleNodes.length === 0

  /* 右键菜单状态（commit 5）—— null = 不显示 */
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
    nodeId: string
  } | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  // ref 类型用 react-force-graph 内部的 NodeObject / LinkObject 包装形态 —— 见 ForceGraph2D 的 ref 推断
  const fgRef = useRef<ForceGraphMethods<unknown, unknown> | undefined>(undefined)
  const dims = useResize(wrapRef)
  const layoutModeRef = useRef<LayoutMode>(layoutModeProp)
  const { motionRef, pointerOverRef, setPointerOver } = useGraphPhysics(
    fgRef,
    visibleData.nodes,
    layoutModeRef
  )

  // 高亮 + 自动居中
  useAutoCenter(fgRef, visibleData.nodes, dims, highlightId)

  // layoutMode 同步到 ref（pointerOver effect 会读它）
  useEffect(() => {
    layoutModeRef.current = layoutModeProp
  }, [layoutModeProp])

  /**
   * 响应 layoutMode 切换：
   *   - 切到 tree：关掉所有动效（orbit/jitter/centripetal 全 0），按 depth 分层钉位；
   *     再 reheat 一次让 d3 把新 fx/fy 写进渲染。
   *   - 切到 analyze：关掉动效但不重排（保留 force 当前位置）。
   *   - 切回 force：清掉所有 fx/fy，恢复默认动效强度（按当前 pointerOver 状态）。
   */
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || visibleData.nodes.length === 0) return
    try {
      if (layoutModeProp === 'tree') {
        motionRef.current.orbit = 0
        motionRef.current.jitter = 0
        motionRef.current.centripetal = 0
        const depths = computeDepths(visibleData.nodes, visibleData.links)
        applyTreeLayout(visibleData.nodes, depths, DEFAULT_TREE_DIMS)
      } else if (layoutModeProp === 'analyze') {
        motionRef.current.orbit = 0
        motionRef.current.jitter = 0
        motionRef.current.centripetal = 0
      } else {
        const over = pointerOverRef.current
        motionRef.current.orbit = over ? 0.004 : 0.05
        motionRef.current.jitter = over ? 0.004 : 0.04
        motionRef.current.centripetal = 0.02
        for (const n of visibleData.nodes) {
          n.fx = undefined
          n.fy = undefined
        }
      }
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('layout mode switch failed:', e)
    }
  }, [layoutModeProp, visibleData.nodes, visibleData.links])

  /**
   * 数据变更（增删节点 / 改边）→ 重算层级位置。
   * 仅在 tree 模式生效。
   */
  useEffect(() => {
    if (layoutModeProp !== 'tree') return
    const fg = fgRef.current
    if (!fg || visibleData.nodes.length === 0) return
    try {
      const depths = computeDepths(visibleData.nodes, visibleData.links)
      applyTreeLayout(visibleData.nodes, depths, DEFAULT_TREE_DIMS)
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('tree layout reapply failed:', e)
    }
  }, [layoutModeProp, visibleData.nodes, visibleData.links])

  /**
   * 高亮节点钉在图中心（force 模式专属）：它作为中心，其它节点继续绕它运动。
   * tree 模式下 applyTreeLayout 已经给每个节点钉了层级位置，这里不能再覆盖。
   */
  useEffect(() => {
    if (!fgRef.current || visibleData.nodes.length === 0) return
    if (layoutModeProp === 'tree') return
    const target = highlightId ? visibleData.nodes.find((n) => n.id === highlightId) : null
    for (const n of visibleData.nodes) {
      if (target && n.id === target.id) {
        n.fx = 0
        n.fy = 0
      } else {
        n.fx = undefined
        n.fy = undefined
      }
    }
    try {
      fgRef.current.d3ReheatSimulation()
    } catch (e) {
      console.warn('pin/reheat failed:', e)
    }
  }, [highlightId, visibleData.nodes, layoutModeProp])

  return (
    <div
      ref={wrapRef}
      className="graph-view"
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
    >
      {noVisibleNodes ? (
        /* commit 3：有数据但过滤掉了全部 → 提示 + 清空过滤 */
        isFiltering && data.nodes.length > 0 ? (
          <div className="empty-filtered">
            <p className="muted">无匹配节点（{data.nodes.length} 个节点被过滤）</p>
            {resetFilters && (
              <button type="button" className="empty-filtered-reset" onClick={resetFilters}>
                清空过滤
              </button>
            )}
          </div>
        ) : (
          <p className="muted empty-hint">{emptyText}</p>
        )
      ) : (
        <ForceGraph2D<BaseGraphNode, BaseGraphLink>
          // ref 类型与 react-force-graph 内部 NodeObject / LinkObject 包装形态冲突 —— 用 any 规避
          ref={fgRef as unknown as React.RefObject<any>}
          graphData={visibleData as unknown as { nodes: BaseGraphNode[]; links: BaseGraphLink[] }}
          width={dims.w}
          height={dims.h}
          backgroundColor={backgroundColor}
          nodeRelSize={4}
          nodeVal={(n) => {
            const base = NODE_SIZE_FN(n)
            /* 搜索命中放大 1.6× */
            if (isSearchActive && searchMatches!.has(n.id)) {
              return base * 1.6
            }
            return base
          }}
          nodeLabel={(n) => getNodeLabel(n as unknown as N)}
          nodeColor={(n) => {
            if (isSearchActive) {
              /* 搜索激活：命中保留原色，未命中灰淡 */
              if (searchMatches!.has(n.id)) {
                return getNodeColor(n as unknown as N)
              }
              return 'rgba(200, 200, 200, 0.18)'
            }
            return getNodeColor(n as unknown as N)
          }}
          linkColor={(l) => {
            const sourceId = typeof l.source === 'string' ? l.source : (l.source as BaseGraphNode).id
            const targetId = typeof l.target === 'string' ? l.target : (l.target as BaseGraphNode).id
            const sourceUnlocked = visibleData.nodes.find((n) => n.id === sourceId)?.unlocked
            const targetUnlocked = visibleData.nodes.find((n) => n.id === targetId)?.unlocked
            if (getLinkColor) {
              return getLinkColor(l as unknown as L, { sourceUnlocked, targetUnlocked })
            }
            if (sourceUnlocked && targetUnlocked) return '#cccccc'
            return '#e8c0c0'
          }}
          linkWidth={getLinkWidth ? ((l) => getLinkWidth(l as unknown as L)) : 1}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.95}
          cooldownTicks={Infinity}
          cooldownTime={Infinity}
          d3VelocityDecay={0.4}
          onNodeDragEnd={(n) => {
            // force 模式下高亮节点拖完回到中心；其它节点保持自由（d3 已在 drag end 清掉 fx/fy）
            if (layoutModeProp === 'force' && highlightId && n.id === highlightId) {
              ;(n as unknown as BaseGraphNode).fx = 0
              ;(n as unknown as BaseGraphNode).fy = 0
            }
            // tree 模式拖完回原层级位置
            if (layoutModeProp === 'tree') {
              const depths = computeDepths(visibleData.nodes, visibleData.links)
              applyTreeLayout(visibleData.nodes, depths, DEFAULT_TREE_DIMS)
            }
            if (onNodeDragEnd) {
              onNodeDragEnd(n as unknown as N)
            }
          }}
          onNodeClick={(n) => {
            if (onSelect) onSelect(n.id)
          }}
          onNodeRightClick={(n, event) => {
            /* preventDefault 阻止浏览器原生 contextmenu */
            event.preventDefault()
            if (!contextMenuItems) return
            const items = contextMenuItems(n as unknown as N)
            if (items.length === 0) return
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              items,
              nodeId: n.id
            })
          }}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(n, ctx, scale) => {
            const node = n as unknown as N & BaseGraphNode
            if (typeof node.x !== 'number' || typeof node.y !== 'number') return

            // app 注入的额外装饰（life analyze 的描边等） —— 先画在最底层
            if (renderNodeDecoration) {
              const nodeSize = 4 * Math.sqrt(node.refCount + 1) + 4
              renderNodeDecoration({ node, ctx, scale, nodeSize })
            }

            // 搜索命中：在节点外圈画蓝色描边
            if (isSearchActive && searchMatches!.has(node.id)) {
              const hitSize = 4 * Math.sqrt(node.refCount + 1) * 1.6 + 4
              ctx.beginPath()
              ctx.arc(node.x, node.y, hitSize + 3, 0, 2 * Math.PI)
              ctx.strokeStyle = '#3b6cf2'
              ctx.lineWidth = 2.5
              ctx.stroke()
            }

            if (scale < 1.2 || !showNodeTitle) return
            const titleText = node.title
            if (!titleText) return
            const titleFontSize = 11 / scale
            ctx.font = `${titleFontSize}px -apple-system, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillStyle = '#333'
            ctx.fillText(titleText, node.x, node.y + 5)

            // 节点 tags 在标题下方画成 chip —— 仅 scale 够大时显示
            const tags = getNodeTags?.(node as N) ?? []
            if (scale >= 1.6 && tags.length > 0) {
              drawTagChips(ctx, tags, node.x, node.y + 5 + titleFontSize * 1.4, scale)
            }
          }}
        />
      )}
      {legend && <div className="graph-legend">{legend}</div>}
      {showForceParams && (
        <ForceParamsPanel
          fgRef={fgRef as unknown as React.RefObject<ForceGraphMethods<unknown, unknown>>}
          motionRef={motionRef}
          onClose={onForceParamsClose ?? ((): void => {})}
        />
      )}
      {setSearchQuery && (
        <SearchBox
          query={searchQuery ?? ''}
          setQuery={setSearchQuery}
          matchCount={matchCount}
        />
      )}
      {showFilters && filters && setFilters && resetFilters && (
        <FiltersPanel
          filters={filters}
          setTags={(tags) => setFilters({ ...filters, tags })}
          setStatuses={(statuses) => setFilters({ ...filters, statuses })}
          setShowOrphans={(v) => setFilters({ ...filters, showOrphans: v })}
          setMinRefCount={(v) => setFilters({ ...filters, minRefCount: v })}
          resetFilters={resetFilters}
          availableTags={availableTags}
          availableStatuses={availableStatuses}
          maxRefCount={maxRefCount}
          onClose={onFiltersClose ?? ((): void => {})}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
      {sidebarGroups && (
        <NodeSidebar
          open={sidebarOpen}
          onToggle={onSidebarToggle ?? ((): void => {})}
          groups={sidebarGroups}
          selectedId={highlightId ?? null}
          onSelect={(id) => onSelect?.(id)}
        />
      )}
    </div>
  )
}

/** 暴露内部 hooks 供 app 复用 —— commit 1+ 会用到 */
export { useGraphPhysics, DEFAULT_MOTION } from './useGraphPhysics'
export type { MotionRef, PhysicsController } from './useGraphPhysics'
export type { GraphFilters } from './useGraphFilters'
export {
  applyTreeLayout,
  computeDepths,
  DEFAULT_TREE_DIMS
} from './useTreeLayout'
export type { TreeLayoutDims } from './useTreeLayout'
export { useAutoCenter, SETTLE_DELAY_MS, IMMEDIATE_CENTER_MS, SETTLE_CENTER_MS } from './useAutoCenter'
export { drawTagChips } from './drawTagChips'
export { ForceParamsPanel } from './ForceParamsPanel'
export { SearchBox } from './SearchBox'
export { FiltersPanel } from './FiltersPanel'
export { ColorPicker } from './ColorPicker'
export type { ColorPickerOption } from './ColorPicker'
export { ContextMenu } from './ContextMenu'
export type { ContextMenuItem } from './ContextMenu'
export { NodeSidebar } from './NodeSidebar'
export type { SidebarGroup, SidebarGroupItem } from './NodeSidebar'
export { tagColor, tagBgColor, hashHue } from './colors'
export type { ColorBy } from './colors'
export { useGraphFilters } from './useGraphFilters'
export { useResize } from './useResize'
export type { Dims } from './useResize'
export type { BaseGraphNode, BaseGraphLink } from './types'