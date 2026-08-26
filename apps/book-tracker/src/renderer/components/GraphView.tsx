import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { computeUnlocked } from '@core'
import type { Book, BookStatus } from '@shared/types'

/**
 * 轨道力：每 tick 给每个节点施加绕中心(0,0)的切向速度。
 *
 * 为什么需要它：
 * d3-force 的 charge/link/center 是"保守力"，节点到达平衡后合力为 0，之后无论
 * alpha 多高都不会再动（alphaTarget 只是让系统保持"热身"，本身不是持续运动的来源）。
 * 之前想用纯 jitter（随机动量）让图"活"，但随机噪声力度一大就像抽搐、力度一小就
 * 被 velocityDecay 磨没，视觉上还是静止。
 *
 * 纯切向速度在连续时间下绕原点做匀速圆周运动（半径守恒；离散 tick 的径向漂移
 * ~ v²/2r 可忽略），所以持续给每个节点一个切向速度，整张图会变成一团缓慢旋转的云：
 * 永远有运动、不抽搐、也不飞散。配合 charge 的散开，就是"灵动又可读"。
 *
 * 高亮节点被钉在中心（fx/fy=0）后，其它节点就绕它转——实现"它作中心、别的能动"。
 *
 * 用闭包注入 nodes（d3-force 调 force 函数时 `this` 在 strict 模式下不可靠）。
 */
function orbitForce(getNodes: () => GraphNode[], getStrength: () => number): (alpha: number) => void {
  return function force(_alpha: number): void {
    const nodes = getNodes()
    if (!nodes || nodes.length === 0) return
    const strength = getStrength()
    if (strength <= 0) return
    for (const n of nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue
      const dx = n.x
      const dy = n.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) continue
      // 绕中心的切向单位向量（逆时针）
      n.vx = (n.vx ?? 0) + (-dy / d) * strength
      n.vy = (n.vy ?? 0) + (dx / d) * strength
    }
  }
}

/**
 * 轻微 jitter：在轨道运动之外加一点随机噪声，让旋转更自然、不呆板。
 * 强度必须小（默认 0.05），否则会盖过轨道运动变成抽搐。
 */
function jitterForce(getNodes: () => GraphNode[], getStrength: () => number): (alpha: number) => void {
  return function force(_alpha: number): void {
    const nodes = getNodes()
    if (!nodes || nodes.length === 0) return
    const strength = getStrength()
    if (strength <= 0) return
    for (const n of nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue
      n.vx = (n.vx ?? 0) + (Math.random() - 0.5) * strength
      n.vy = (n.vy ?? 0) + (Math.random() - 0.5) * strength
    }
  }
}

interface GraphViewProps {
  highlightId?: string | null
  onSelect?: (id: string) => void
}

const STATUS_COLORS: Record<BookStatus, string> = {
  want: '#999999',
  shelved: '#c89456',
  reading: '#4a7c59',
  finished: '#2d5a3a',
  abandoned: '#c0573d'
}

const STATUS_LABEL: Record<BookStatus, string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
}

interface GraphNode {
  id: string
  title: string
  author: string
  status: BookStatus
  refCount: number
  unlocked: boolean
  x?: number
  y?: number
  /** d3-force 在 tick 时会写入的字段，自定义 orbit/jitter force 也读这两个 */
  vx?: number
  vy?: number
  /** 钉住节点到固定坐标时由 d3-force 写 / 读；undefined 表示不钉 */
  fx?: number
  fy?: number
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

  // 交互感知的"呼吸"：鼠标不在图上时轨道力正常（图在缓慢流动、显得"活"）；
  // 鼠标一进图区域就把轨道/jitter 降到接近 0——图"停住"。force-graph 的
  // hover/点击/拖动命中靠一张 800ms 才刷新一次的 shadow canvas，节点一直高速运动
  // 时点击会落空（点到可见位置、命中却在别处），甚至被当成拖拽把整张图拖出视野。
  // 鼠标悬停时让图静止，抓取/点击才能稳定可靠。
  const motionRef = useRef({ orbit: 0.05, jitter: 0.04 })
  const setPointerOver = (over: boolean): void => {
    motionRef.current.orbit = over ? 0.004 : 0.05
    motionRef.current.jitter = over ? 0.004 : 0.04
  }

  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  const select = useBooksStore((s) => s.select)

  const data = useMemo(() => {
    const refCount = new Map<string, number>()
    for (const b of books) refCount.set(b.id, 0)
    for (const e of edges) {
      for (const p of e.prerequisites) refCount.set(p, (refCount.get(p) ?? 0) + 1)
    }
    const { unlocked } = computeUnlocked(
      books.map((b) => b.id),
      edges,
      (id) => books.some((b) => b.id === id && b.status === 'finished')
    )
    const nodes: GraphNode[] = books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
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
  }, [books, edges])

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
  // 2) 等力导向模拟收敛（d3 默认 alphaMin≈0.001，约 300 帧 ≈5s）后，按节点最终位置再精确居中一次。
  //    不能暂停模拟：pauseAnimation 会 cancelAnimationFrame 停掉整个渲染循环，
  //    居中 tween 画不出来、hover/点击命中也会失效（点了没反应）。
  const settleTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  // 注册持续抖动 force：mount 后 fgRef 就绪时挂上。d3Force('jitter') 在 d3 内
  // 模拟 tick 时被调用，每次给每个节点一个微小随机动量；不依赖 alphaTarget/alpha。
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      // d3-force simulation 直接修改传入的 nodes 引用，data.nodes 就是 simulation 的 nodes
      // 更强的电荷斥力：默认 -30 对小图太弱，节点会挤成一团；-80 让它们散开、可读。
      const charge = fg.d3Force('charge')
      if (charge && typeof charge.strength === 'function') charge.strength(-80)
      fg.d3Force('orbit', orbitForce(() => data.nodes, () => motionRef.current.orbit))
      fg.d3Force('jitter', jitterForce(() => data.nodes, () => motionRef.current.jitter))
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('jitter force registration failed:', e)
    }
  }, [data.nodes])

  // 高亮节点钉在图中心：它作为中心，其它节点继续绕它运动。
  // - highlightId 有值 → 该节点 fx/fy 钉在 (0,0)（forceCenter 的质心，即画布中心）；
  // - highlightId 为 null → 解除所有钉住，恢复自由布局。
  // 钉住/解除后 reheat 一次，让布局重新铺开。
  useEffect(() => {
    if (!fgRef.current || data.nodes.length === 0) return
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
  }, [highlightId, data.nodes])

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
    <div
      ref={wrapRef}
      className="graph-view"
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
    >
      {data.nodes.length === 0 ? (
        <p className="muted empty-hint">还没有作品。加几部试试。</p>
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
          cooldownTicks={Infinity}
          cooldownTime={Infinity}
          d3VelocityDecay={0.4}
          onNodeDragEnd={(n) => {
            // 高亮节点拖完回到中心；其它节点保持自由（d3 已在 drag end 清掉 fx/fy）
            if (highlightId && n.id === highlightId) {
              n.fx = 0
              n.fy = 0
            }
          }}
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
        <span className="lg-dot" style={{ background: STATUS_COLORS.want }} />想看
        <span className="lg-dot" style={{ background: STATUS_COLORS.reading }} />在读
        <span className="lg-dot" style={{ background: STATUS_COLORS.finished }} />已读
        <span className="lg-dot" style={{ background: STATUS_COLORS.shelved }} />搁置
        <span className="lg-dot" style={{ background: STATUS_COLORS.abandoned }} />弃读
        <span className="lg-sep" />
        <span className="lg-dot" style={{ background: '#c8c8c8' }} />未解锁
      </div>
    </div>
  )
}
