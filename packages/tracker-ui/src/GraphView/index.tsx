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

import { useEffect, useRef } from 'react'
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
    highlightId,
    onSelect,
    onNodeDragEnd,
    emptyText = '还没有数据。',
    backgroundColor = '#fafaf8',
    legend
  } = props

  const wrapRef = useRef<HTMLDivElement>(null)
  // ref 类型用 react-force-graph 内部的 NodeObject / LinkObject 包装形态 —— 见 ForceGraph2D 的 ref 推断
  const fgRef = useRef<ForceGraphMethods<unknown, unknown> | undefined>(undefined)
  const dims = useResize(wrapRef)
  const layoutModeRef = useRef<LayoutMode>(layoutModeProp)
  const { motionRef, pointerOverRef, setPointerOver } = useGraphPhysics(
    fgRef,
    data.nodes,
    layoutModeRef
  )

  // 高亮 + 自动居中
  useAutoCenter(fgRef, data.nodes, dims, highlightId)

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
    if (!fg || data.nodes.length === 0) return
    try {
      if (layoutModeProp === 'tree') {
        motionRef.current.orbit = 0
        motionRef.current.jitter = 0
        motionRef.current.centripetal = 0
        const depths = computeDepths(data.nodes, data.links)
        applyTreeLayout(data.nodes, depths, DEFAULT_TREE_DIMS)
      } else if (layoutModeProp === 'analyze') {
        motionRef.current.orbit = 0
        motionRef.current.jitter = 0
        motionRef.current.centripetal = 0
      } else {
        const over = pointerOverRef.current
        motionRef.current.orbit = over ? 0.004 : 0.05
        motionRef.current.jitter = over ? 0.004 : 0.04
        motionRef.current.centripetal = 0.02
        for (const n of data.nodes) {
          n.fx = undefined
          n.fy = undefined
        }
      }
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('layout mode switch failed:', e)
    }
  }, [layoutModeProp, data.nodes, data.links])

  /**
   * 数据变更（增删节点 / 改边）→ 重算层级位置。
   * 仅在 tree 模式生效。
   */
  useEffect(() => {
    if (layoutModeProp !== 'tree') return
    const fg = fgRef.current
    if (!fg || data.nodes.length === 0) return
    try {
      const depths = computeDepths(data.nodes, data.links)
      applyTreeLayout(data.nodes, depths, DEFAULT_TREE_DIMS)
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('tree layout reapply failed:', e)
    }
  }, [layoutModeProp, data.nodes, data.links])

  /**
   * 高亮节点钉在图中心（force 模式专属）：它作为中心，其它节点继续绕它运动。
   * tree 模式下 applyTreeLayout 已经给每个节点钉了层级位置，这里不能再覆盖。
   */
  useEffect(() => {
    if (!fgRef.current || data.nodes.length === 0) return
    if (layoutModeProp === 'tree') return
    const target = highlightId ? data.nodes.find((n) => n.id === highlightId) : null
    for (const n of data.nodes) {
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
  }, [highlightId, data.nodes, layoutModeProp])

  return (
    <div
      ref={wrapRef}
      className="graph-view"
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
    >
      {data.nodes.length === 0 ? (
        <p className="muted empty-hint">{emptyText}</p>
      ) : (
        <ForceGraph2D<BaseGraphNode, BaseGraphLink>
          // ref 类型与 react-force-graph 内部 NodeObject / LinkObject 包装形态冲突 —— 用 any 规避
          ref={fgRef as unknown as React.RefObject<any>}
          graphData={data as unknown as { nodes: BaseGraphNode[]; links: BaseGraphLink[] }}
          width={dims.w}
          height={dims.h}
          backgroundColor={backgroundColor}
          nodeRelSize={4}
          nodeVal={NODE_SIZE_FN}
          nodeLabel={(n) => getNodeLabel(n as unknown as N)}
          nodeColor={(n) => getNodeColor(n as unknown as N)}
          linkColor={(l) => {
            const sourceId = typeof l.source === 'string' ? l.source : (l.source as BaseGraphNode).id
            const targetId = typeof l.target === 'string' ? l.target : (l.target as BaseGraphNode).id
            const sourceUnlocked = data.nodes.find((n) => n.id === sourceId)?.unlocked
            const targetUnlocked = data.nodes.find((n) => n.id === targetId)?.unlocked
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
              const depths = computeDepths(data.nodes, data.links)
              applyTreeLayout(data.nodes, depths, DEFAULT_TREE_DIMS)
            }
            if (onNodeDragEnd) {
              onNodeDragEnd(n as unknown as N)
            }
          }}
          onNodeClick={(n) => {
            if (onSelect) onSelect(n.id)
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
    </div>
  )
}

/** 暴露内部 hooks 供 app 复用 —— commit 1+ 会用到 */
export { useGraphPhysics, DEFAULT_MOTION } from './useGraphPhysics'
export type { MotionRef, PhysicsController } from './useGraphPhysics'
export {
  applyTreeLayout,
  computeDepths,
  DEFAULT_TREE_DIMS
} from './useTreeLayout'
export type { TreeLayoutDims } from './useTreeLayout'
export { useAutoCenter, SETTLE_DELAY_MS, IMMEDIATE_CENTER_MS, SETTLE_CENTER_MS } from './useAutoCenter'
export { drawTagChips } from './drawTagChips'
export { useResize } from './useResize'
export type { Dims } from './useResize'
export type { BaseGraphNode, BaseGraphLink } from './types'