import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { computeUnlocked, groupMemberId } from '@core'
import { buildDonePredicate } from '@shared/done'
import type { Edge, GoalStatus, PrereqSpec } from '@shared/types'

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

/**
 * 向心力：每 tick 给每个节点施加一个指向 (0,0) 的径向速度增量。
 *
 * 与 orbitForce 互为反向——orbit 是切向（让节点绕中心转），centripetal 是径向
 * 向心（让节点被拉近中心）。两个力一起作用时，节点仍能保持绕转，但轨道半径
 * 会被向心力收小，整张图视觉上更紧凑、不"摊"成一片大饼。
 *
 * 强度是直接加到 vx/vy 上的常量，不是按距离衰减的（与 orbit 同风格）；
 * 实际效果接近"持续弱重力"，在 charge = -80 的斥力场里找到新平衡。
 * strength=0 时函数立即 return，d3 仍会每 tick 调一次（成本可忽略）。
 */
function centripetalForce(getNodes: () => GraphNode[], getStrength: () => number): (alpha: number) => void {
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
      // 指向中心的单位向量（与 orbitForce 的切向分量垂直、方向相反）
      n.vx = (n.vx ?? 0) + (-dx / d) * strength
      n.vy = (n.vy ?? 0) + (-dy / d) * strength
    }
  }
}

/**
 * 计算每个节点的"深度"：以"前置依赖链"长度为单位。
 *
 * 语义对齐用户的层级布局需求："从下往上越来越后置"——
 *   - depth=0 的节点 = 叶子 = 无前置（最底层、最初的"前置"任务）
 *   - depth=max 的节点 = 根 = 没有依赖其上的任务（最顶层、最"后置"的总目标）
 *
 * 用 DFS 沿 dependsOn 边向下走，深度 = max(prereq 深度) + 1。
 * 环检测：visiting 集合发现回边时返回 0（环上节点的深度按"已访问的非环 prereq"
 * 算，避免无限递归）。环上深度相同会导致它们叠在同一层——
 * 这与"层级模式是确定性位置"的语义冲突但不致命，视觉上能看出"这几个扎堆了"。
 *
 * 不动 node.x/y，只是把计算结果交给 applyTreeLayout 用。
 */
function computeDepths(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
  const dependsOn = new Map<string, Set<string>>()
  for (const n of nodes) dependsOn.set(n.id, new Set())
  for (const l of links) {
    const srcId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
    const tgtId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
    if (dependsOn.has(tgtId)) dependsOn.get(tgtId)!.add(srcId)
  }

  const depth = new Map<string, number>()
  const visiting = new Set<string>()

  const getDepth = (id: string): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0 /* 环：把这条边视为"已断"，避免无限递归 */
    visiting.add(id)

    const prereqs = dependsOn.get(id) ?? new Set<string>()
    let maxD = 0
    for (const p of prereqs) {
      const d = getDepth(p)
      if (d > maxD) maxD = d
    }
    const result = prereqs.size === 0 ? 0 : maxD + 1
    depth.set(id, result)
    visiting.delete(id)
    return result
  }

  for (const n of nodes) getDepth(n.id)
  return depth
}

/**
 * 树形布局：按 depth 分层摆放 + 钉死 (fx/fy)。
 *
 * 坐标系：
 *   - canvas 原点在左上，y 向下为正；"从下往上"在屏幕坐标系里就是 y 越小越靠上
 *   - depth=0（叶）放在 y = maxDepth * layerHeight（屏幕下方）
 *   - depth=maxDepth（根）放在 y = 0（屏幕上方）
 *   - 同一层内按 id 排序后水平均匀分布，居中
 *
 * 钉死是为了"更加固定"——用户明确希望这个模式不要像力导向那样动。
 * 高亮节点也保持其层级位置（不再像力导向里被钉到 (0,0)），点击高亮的"两段式居中"
 * 仍由 highlight effect 触发，把视图平移到它的层级坐标。
 */
function applyTreeLayout(
  nodes: GraphNode[],
  depths: Map<string, number>,
  dims: { layerHeight: number; layerWidth: number }
): void {
  const byDepth = new Map<number, GraphNode[]>()
  for (const n of nodes) {
    const d = depths.get(n.id) ?? 0
    let arr = byDepth.get(d)
    if (!arr) {
      arr = []
      byDepth.set(d, arr)
    }
    arr.push(n)
  }

  let maxDepth = 0
  for (const d of byDepth.keys()) if (d > maxDepth) maxDepth = d

  for (const [d, layer] of byDepth.entries()) {
    const y = (maxDepth - d) * dims.layerHeight
    /* 同层按 id 排序，节点增删时位置不会乱跳 */
    layer.sort((a, b) => a.id.localeCompare(b.id))
    const n = layer.length
    layer.forEach((node, i) => {
      const x = (i - (n - 1) / 2) * dims.layerWidth
      node.x = x
      node.y = y
      /* 钉死：让 d3 在 tree 模式下不再自由漂浮；切回 force 时由 mode effect 清 */
      node.fx = x
      node.fy = y
    })
  }
}

interface GraphViewProps {
  highlightId?: string | null
  onSelect?: (id: string) => void
}

type LayoutMode = 'force' | 'tree'

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
 *     d3-force-link 把每条 link 当独立力，平行边让两端被 N 倍向心力拉近、节点挤成团；
 *     渲染时多条线重叠、点击/拖动命中也被错位的影子干扰。
 *     refCount 也是 specs 数（不是目标数），B 节点大小被夸大、与被几个不同 target 引用无关。
 *   - 旧 AND-of-ORs 路径下，同一 id 出现在多个 groups / `count`/`group` spec 里也会堆积。
 * 卸载只影响『画几条边』：computeUnlocked 仍按 specs 全集判定，解锁语义不变。
 *
 * 过滤悬空引用：source / target 不在 `validIds` 里的 link 直接丢弃。
 *  —— dangling 来源会让 d3-force-3d 在 initialize 阶段抛 `node not found: X`
 *   （react-force-graph-2d 内部用的就是 d3-force-3d forceLink 的 `find()`）。
 *   每条悬空 link 一次"node not found"异常，在 GraphView 重新挂载 / 数据变更 /
 *   force-graph 内部重画时都会被同步抛出 → 控制台一堆红字。
 *   与 computeUnlocked 的 filter(idSet.has) 对齐：unlock 算法早就忽略悬空 prereq，
 *   画图层也按同一份"已存在 goal id 集合"过滤即可。
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

  // 先按优先级收集边，最后统一去重 + 悬空过滤
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
    // 旧 AND-of-ORs：mandatory prereqs（不在任何 group 里）+ 各 group member
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
    // 纯旧数据：直接读 prerequisites（向后兼容老 relations.json）
    for (const p of edge.prerequisites) {
      const l = mkLink(p)
      if (l) collected.push(l)
    }
  }

  // (source, target) 去重——见上方注释；refCount 紧接着在本函数外按此集合自增，
  // 自然得到「被几个不同 target 引用」的语义，与 book-tracker 的 `prerequisites.map`
  // 自然去重一致。
  const seen = new Set<string>()
  return collected.filter((l) => {
    const key = `${l.source}->${edge.to}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function GraphView({ highlightId, onSelect }: GraphViewProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const [dims, setDims] = useState({ w: 800, h: 600 })
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force')

  // 交互感知的"呼吸"：鼠标不在图上时轨道力正常（图在缓慢流动、显得"活"）；
  // 鼠标一进图区域就把轨道/jitter 降到接近 0——图"停住"。force-graph 的
  // hover/点击/拖动命中靠一张 800ms 才刷新一次的 shadow canvas，节点一直高速运动
  // 时点击会落空（点到可见位置、命中却在别处），甚至被当成拖拽把整张图拖出视野。
  // 鼠标悬停时让图静止，抓取/点击才能稳定可靠。
  // centripetal 是用户新要求的"持续向心弱重力"：与 charge 的斥力平衡，决定稳态轨道半径。
  // 强度用闭包注入（motionRef 改值即可，无需重新注册 force）。
  const motionRef = useRef({ orbit: 0.05, jitter: 0.04, centripetal: 0.02 })
  /* pointerOver 单独放一个 ref：mode 切换 effect 要读它来恢复 force 模式默认力 */
  const pointerOverRef = useRef(false)
  const layoutModeRef = useRef<LayoutMode>('force')
  const setPointerOver = (over: boolean): void => {
    pointerOverRef.current = over
    /* tree 模式所有力都为 0（强制钉位）；force 模式才按悬停状态调 */
    if (layoutModeRef.current === 'force') {
      motionRef.current.orbit = over ? 0.004 : 0.05
      motionRef.current.jitter = over ? 0.004 : 0.04
    }
  }

  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const select = useGoalsStore((s) => s.select)

  const data = useMemo(() => {
    // 链接与 refCount 都按 specs / groups 拆，而不是直读 e.prerequisites：
    // - specs 路径下 prerequisites 可能含「旧裸 id 兜底」遗留（PrereqEditor persist
    //   §5 兜底逻辑保留），把它们画成边会渲染出与 specs 语义不符的废链接；
    // - 旧 AND-of-ORs 路径（groups）下 mandatory prereqs 与 group members 的视觉差异
    //   应由 deriveLinks 内部按"不在任何 group 里"判定，不能一股脑 flatMap；
    // - exclude spec 不画边（谓词已在 isDone 改写里处理）；
    // - source / target 不在 goals 里的悬空 link 一律丢弃，避免 d3-force-3d 的
    //   `find()` 抛 "node not found" 异常（旧数据迁移期常见，已删除 goal 但 edge 仍
    //   引用其 id 的场景；book-tracker 同款过滤逻辑在 prereq_simulation / computeUnlocked
    //   里都有，画图层一直没接上才造成"右键一堆 error"的视觉症状）。
    const goalIds = new Set(goals.map((b) => b.id))
    const links: GraphLink[] = []
    const refCount = new Map<string, number>()
    for (const b of goals) refCount.set(b.id, 0)
    for (const e of edges) {
      const ls = deriveLinks(e, goalIds)
      for (const l of ls) {
        const sid = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
        refCount.set(sid, (refCount.get(sid) ?? 0) + 1)
      }
      links.push(...ls)
    }

    // 用 buildDonePredicate 而非裸 isGoalDone：
    // 1) 互斥规则（exclude）会改写 done 谓词——GraphView 必须应用，否则图里看不到 trigger 的影响；
    // 2) countable 任务的 done 由 requiredCount 与 progress.current 比较（不是 status==='done'），
    //    旧 1-arg isGoalDone 谓词会让 countable 任务在图里永远灰。
    const { isDone } = buildDonePredicate(goals, edges)
    const { unlocked } = computeUnlocked(
      goals.map((b) => b.id),
      edges,
      isDone
    )
    const nodes: GraphNode[] = goals.map((b) => ({
      id: b.id,
      title: b.title,
      category: b.category,
      status: b.status,
      refCount: refCount.get(b.id) ?? 0,
      unlocked: unlocked.get(b.id) ?? true
    }))
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
  // 2) 等力导向模拟收敛（d3 默认 alphaMin≈0.001，约 300 帧 ≈5s）后，按节点最终位置再精确居中一次。
  //    不能暂停模拟：pauseAnimation 会 cancelAnimationFrame 停掉整个渲染循环，
  //    居中 tween 画不出来、hover/点击命中也会失效（点了没反应）。
  const settleTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  // 注册持续抖动 force：mount 后 fgRef 就绪时挂上。d3Force('jitter') 已在 d3 内
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
      /* 新增的向心力：见 centripetalForce 注释；强度由 motionRef.centripetal 控制 */
      fg.d3Force('centripetal', centripetalForce(() => data.nodes, () => motionRef.current.centripetal))
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('jitter force registration failed:', e)
    }
  }, [data.nodes])

  /**
   * 响应 layoutMode 切换：
   *   - 切到 tree：关掉所有动效（orbit/jitter/centripetal 全 0），按 depth 分层钉位；
   *     再 reheat 一次让 d3 把新 fx/fy 写进渲染（实际 reheat 后节点会被 d3 拖去 fx/fy）。
   *   - 切回 force：清掉所有 fx/fy，恢复默认动效强度（按当前 pointerOver 状态）。
   *
   * 不在 mode 切换 effect 里 re-render ForceGraph2D（key 变化那种）：
   *   d3Force('xxx', forceFn) 已经能就地替换 force 对象、保持 simulation 句柄不变，
   *   只是对节点的更新要等下一个 tick。整图重挂载会丢掉 zoom/center 状态、不必要。
   */
  useEffect(() => {
    layoutModeRef.current = layoutMode
    const fg = fgRef.current
    if (!fg || data.nodes.length === 0) return
    try {
      if (layoutMode === 'tree') {
        motionRef.current.orbit = 0
        motionRef.current.jitter = 0
        motionRef.current.centripetal = 0
        const depths = computeDepths(data.nodes, data.links)
        applyTreeLayout(data.nodes, depths, { layerHeight: 130, layerWidth: 170 })
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
  }, [layoutMode, data.nodes, data.links])

  /**
   * 数据变更（增删 goal / 改边）→ 重算层级位置。
   * 仅在 tree 模式生效；force 模式由 d3 自己处理。
   * mode effect 也依赖 data.nodes/data.links，但只会在 layoutMode 真变时切；
   * 这里用一个独立 effect，保证数据变更也会刷新层级位置（mode 不变时）。
   */
  useEffect(() => {
    if (layoutMode !== 'tree') return
    const fg = fgRef.current
    if (!fg || data.nodes.length === 0) return
    try {
      const depths = computeDepths(data.nodes, data.links)
      applyTreeLayout(data.nodes, depths, { layerHeight: 130, layerWidth: 170 })
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('tree layout reapply failed:', e)
    }
  }, [layoutMode, data.nodes, data.links])

  // 高亮节点钉在图中心（force 模式专属）：它作为中心，其它节点继续绕它运动。
  // - highlightId 有值 → 该节点 fx/fy 钉在 (0,0)（forceCenter 的质心，即画布中心）；
  // - highlightId 为 null → 解除钉住，恢复自由布局。
  // tree 模式下 applyTreeLayout 已经给每个节点钉了层级位置，这里不能再覆盖；
  // 否则高亮节点会被拽回 (0,0)，破坏层级视觉。
  useEffect(() => {
    if (!fgRef.current || data.nodes.length === 0) return
    if (layoutMode === 'tree') return /* tree 模式不重写 fx/fy */
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
  }, [highlightId, data.nodes, layoutMode])

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
          cooldownTicks={Infinity}
          cooldownTime={Infinity}
          d3VelocityDecay={0.4}
          onNodeDragEnd={(n) => {
            // force 模式下高亮节点拖完回到中心；其它节点保持自由（d3 已在 drag end 清掉 fx/fy）
            if (layoutMode === 'force' && highlightId && n.id === highlightId) {
              n.fx = 0
              n.fy = 0
            }
            /* tree 模式拖完回原层级位置（d3 已经在 drag end 清了 fx/fy；
               立刻重新钉回 layer 位置，避免变成"自由节点"破坏层级） */
            if (layoutMode === 'tree') {
              const depths = computeDepths(data.nodes, data.links)
              applyTreeLayout(data.nodes, depths, { layerHeight: 130, layerWidth: 170 })
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
        <span className="lg-dot" style={{ background: STATUS_COLORS.not_started }} />未开始
        <span className="lg-dot" style={{ background: STATUS_COLORS.in_progress }} />进行中
        <span className="lg-dot" style={{ background: STATUS_COLORS.done }} />已达成
        <span className="lg-dot" style={{ background: STATUS_COLORS.shelved }} />搁置
        <span className="lg-dot" style={{ background: STATUS_COLORS.abandoned }} />放弃
        <span className="lg-sep" />
        <span className="lg-dot" style={{ background: '#c8c8c8' }} />未解锁
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
      </div>
    </div>
  )
}
