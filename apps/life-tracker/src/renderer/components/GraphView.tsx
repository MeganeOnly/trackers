import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { computeUnlocked } from '@core'
import { isGoalDone } from '@shared/types'
import type { Goal, GoalStatus } from '@shared/types'

interface GraphViewProps {
  highlightId?: string | null
  onSelect?: (id: string) => void
}

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

interface GraphNode {
  id: string
  title: string
  category: string
  status: GoalStatus
  refCount: number
  unlocked: boolean
  x?: number
  y?: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  rule: 'all' | 'any_of'
  threshold?: number
}

export function GraphView({ highlightId, onSelect }: GraphViewProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const [dims, setDims] = useState({ w: 800, h: 600 })

  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const select = useGoalsStore((s) => s.select)

  const data = useMemo(() => {
    const refCount = new Map<string, number>()
    for (const b of goals) refCount.set(b.id, 0)
    for (const e of edges) {
      for (const p of e.prerequisites) refCount.set(p, (refCount.get(p) ?? 0) + 1)
    }
    const { unlocked } = computeUnlocked(
      goals.map((b) => b.id),
      edges,
      (id) => {
        const g = goals.find((x) => x.id === id)
        return g ? isGoalDone(g) : false
      }
    )
    const nodes: GraphNode[] = goals.map((b) => ({
      id: b.id,
      title: b.title,
      category: b.category,
      status: b.status,
      refCount: refCount.get(b.id) ?? 0,
      unlocked: unlocked.get(b.id) ?? true
    }))
    const links: GraphLink[] = edges.flatMap((e) =>
      e.prerequisites.map((p) => ({
        source: p,
        target: e.to,
        rule: e.rule,
        threshold: e.threshold
      }))
    )
    return { nodes, links }
  }, [goals, edges])

  useLayoutEffect(() => {
    if (!wrapRef.current) return
    const measure = (): void => {
      const rect = wrapRef.current!.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setDims({ w: rect.width, h: rect.height })
      }
    }
    measure()                              /* 同步测一次，避免初次 800x600 flash */
    const ro = new ResizeObserver(measure)
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // 两段式居中：
  // 1) 点击后立即 centerAt（即时反馈；此时可能碰上画布 resize / 模拟还在跑，位置是近似的）
  // 2) 等力导向模拟收敛（cooldownTicks 120 ≈ 2s）后，按节点最终位置再精确居中一次。
  //    不能暂停模拟：pauseAnimation 会 cancelAnimationFrame 停掉整个渲染循环，
  //    居中 tween 画不出来、hover/点击命中也会失效（点了没反应）。
  const settleTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  useEffect(() => {
    if (!highlightId || !fgRef.current) return
    const node = data.nodes.find((n) => n.id === highlightId)
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      fgRef.current.centerAt(node.x, node.y, 350)
    }
  }, [highlightId, data.nodes, dims])

  useEffect(() => {
    window.clearTimeout(settleTimer.current)
    if (!highlightId) return
    settleTimer.current = window.setTimeout(() => {
      if (!fgRef.current) return
      const node = data.nodes.find((n) => n.id === highlightId)
      if (node && typeof node.x === 'number' && typeof node.y === 'number') {
        fgRef.current.centerAt(node.x, node.y, 250)
      }
    }, 2500)
    return () => window.clearTimeout(settleTimer.current)
  }, [highlightId, data.nodes])

  return (
    <div ref={wrapRef} className="graph-view">
      {data.nodes.length === 0 ? (
        <p className="muted empty-hint">还没有目标。加几个试试。</p>
      ) : (
        <ForceGraph2D<GraphNode, GraphLink>
          ref={fgRef}
          graphData={data}
          width={dims.w}
          height={dims.h}
          backgroundColor="#fafaf8"
          nodeRelSize={4}
          nodeVal={(n) => 1 + Math.sqrt(n.refCount) * 2}
          nodeLabel={(n) => `${n.title} (${STATUS_LABEL[n.status]})`}
          nodeColor={(n) => {
            if (highlightId && n.id === highlightId) return '#3b6cf2'
            if (!n.unlocked) return '#c8c8c8'
            return STATUS_COLORS[n.status]
          }}
          linkColor={(l) => {
            const sourceId = typeof l.source === 'string' ? l.source : l.source.id
            const targetId = typeof l.target === 'string' ? l.target : l.target.id
            const sourceUnlocked = data.nodes.find((n) => n.id === sourceId)?.unlocked
            const targetUnlocked = data.nodes.find((n) => n.id === targetId)?.unlocked
            if (sourceUnlocked && targetUnlocked) return '#cccccc'
            return '#e8c0c0'
          }}
          linkWidth={1}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.95}
          cooldownTicks={120}
          onNodeClick={(n) => {
            select(n.id)
            onSelect?.(n.id)
            // 居中由 highlightId 变化的两段式效果处理（立即 + 模拟收敛后精确居中）
          }}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(n, ctx, scale) => {
            if (typeof n.x !== 'number' || typeof n.y !== 'number') return
            if (scale < 1.2) return
            const fontSize = 11 / scale
            ctx.font = `${fontSize}px -apple-system, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillStyle = '#333'
            ctx.fillText(n.title, n.x, n.y + 5)
          }}
        />
      )}
      <div className="graph-legend">
        <span className="lg-dot" style={{ background: STATUS_COLORS.not_started }} />未开始
        <span className="lg-dot" style={{ background: STATUS_COLORS.in_progress }} />进行中
        <span className="lg-dot" style={{ background: STATUS_COLORS.done }} />已达成
        <span className="lg-dot" style={{ background: STATUS_COLORS.shelved }} />搁置
        <span className="lg-dot" style={{ background: STATUS_COLORS.abandoned }} />放弃
        <span className="lg-sep" />
        <span className="lg-dot" style={{ background: '#c8c8c8' }} />未解锁
      </div>
    </div>
  )
}
