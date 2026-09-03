// tracker-core —— Unlock 图健康度分析
//
// 在 computeUnlocked 之上加一层"读懂图"：
// - 哪些节点是孤立的 / 是根 / 是叶 / 是瓶颈
// - 距离某个总目标还有多远（critical path）
// - 整张图是否健康（health score）
//
// 设计目标（与 unlock.ts 同风格）：
// - 纯函数、纯算法：零副作用、可单测
// - 不引入第三方依赖：拓扑/DFS/DP 全手写
// - 不破坏 frontmatter 显式哲学：只读不改
// - 不绑领域：book / life 都可调（仅依赖 Edge / done 谓词）
//
// 与 computeUnlocked / computeBlockingRelations 的对齐：
// - 悬空引用一律忽略（idSet.has(r) 过滤）
// - exclude spec 不算正向引用（不画边、不进拓扑、不入度）
// - 环上节点不参与 critical path / degree 统计（detected via detectCycles）
// - done 谓词签名一致：(id, requiredCount) => boolean
//
// 不与 computeUnlocked 对齐的点（有意为之）：
// - analyze 不重写谓词（由调用方传 done 谓词，应用层该传 buildDonePredicate 改写后的）
// - analyze 不区分 countable 任务的"完成 N 次"概念（bottleneck 关心"卡住别人"，
//   跟"自己完成几次"无关）；简化用 isDone(id, 1)。

import type { Edge } from './types'
import { detectCycles } from './unlock'

/** 一个节点的拓扑特征 */
export interface NodeRole {
  id: string
  /** 入度：多少条边指向我（多少下游依赖我） */
  inDegree: number
  /** 出度：我指向多少下游 */
  outDegree: number
  /** done 谓词判定结果（requiredCount 简化为 1） */
  isDone: boolean
}

/** 真瓶颈：未完成 + 被多个下游依赖 */
export interface Bottleneck {
  id: string
  /** score = outDegree；越高越卡（被越多下游依赖） */
  score: number
  /** 下游节点 id 列表（去重） */
  blocks: string[]
}

/**
 * 健康度评分拆解（前端做 breakdown 展示）
 *
 * v2 算法（2026-08）：4 维度共 100 分。
 * - 完成率 40 分（加分项，按 0-1 比例 × 40）
 * - 孤立 20 分（扣分项，每孤立 1 分；≥2 个孤立且孤立比例 >20% 时直接扣光）
 * - 瓶颈 25 分（扣分项，每瓶颈 2 分；≥2 个瓶颈且瓶颈比例 >30% 时直接扣光）
 * - 深度 15 分（扣分项，关键路径 >5 步开始，每超 1 步扣 3 分）
 *
 * v1 算法：40 + 30 + 30 = 100，每孤立扣 5、每瓶颈扣 3（无规模归一化、无深度维度）。
 * 痛点：大图小孤立也被瞬间扣光、小图小孤立被误伤、长期 shelved 目标持续扣完成率。
 * v2 改动：
 *  - 孤立/瓶颈扣分密度降低，阈值放大（孤立 20 个、瓶颈 12 个才扣光）
 *  - 加比例兜底：≥2 个孤立且孤立比例 >20% / ≥2 个瓶颈且瓶颈比例 >30% 时整体扣光
 *    （单孤立/单瓶颈不触发，避免小图误伤）
 *  - 加深度维度：关键路径 >5 步开始扣分（管理负担信号）
 *  - 加 isInactive 谓词：shelved/abandoned 节点不计入 active 分母，避免"放弃的目标"持续扣分
 */
export interface HealthBreakdown {
  /** 完成率得分：completionRate × 40（0..40） */
  completionRateScore: number
  /** 孤立节点得分：max(0, 20 - orphans.length)；≥2 个孤立且孤立比例 >20% 时归 0 */
  orphanScore: number
  /** 瓶颈节点得分：max(0, 25 - bottlenecks.length × 2)；≥2 个瓶颈且瓶颈比例 >30% 时归 0 */
  bottleneckScore: number
  /** 深度扣分：max(0, 15 - max(0, maxDepth - 5) × 3)；深度 ≤5 时满分 15 */
  depthScore: number
  /** 用于计算孤立/瓶颈比率的分母（= total - inactiveCount） */
  activeTotal: number
  /** shelved + abandoned 节点数（从 active 分母中扣除） */
  inactiveCount: number
}

/** 图健康度分析的完整输出 */
export interface GraphAnalysis {
  stats: {
    total: number
    done: number
    /** 0..1（按 activeTotal 计算；activeTotal=0 时视为 1） */
    completionRate: number
    avgInDegree: number
    avgOutDegree: number
    /** 关键路径最长长度（未完成节点链的步数） */
    maxDepth: number
    /** 不连通子图数（仅含至少一条边的节点构成的分量） */
    components: number
    /** 计入完成率/孤立/瓶颈比率的分母（= total - inactiveCount） */
    activeTotal: number
    /** shelved + abandoned 节点数 */
    inactiveCount: number
  }
  /** 0 入度 + 0 出度：完全孤立的节点 */
  orphans: string[]
  /** 0 入度 + N 出度：根节点（重要的"基础目标"），按 outDegree 降序 */
  roots: Array<NodeRole & { blocks: string[] }>
  /** N 入度 + 0 出度：终节点（最终目标） */
  leaves: string[]
  /** 真瓶颈 top 10（按 score 降序；不含已 done 节点） */
  bottlenecks: Bottleneck[]
  /** 0..100 健康度评分 */
  healthScore: number
  healthBreakdown: HealthBreakdown
  /** 关键路径上的节点 id 列表（从根到 leaf）；可能为空（已全部 done） */
  criticalPath: string[]
}

// ============================================================
// 入口
// ============================================================

/**
 * 给定节点 id 全集 + edges + done 谓词，输出完整分析结果。
 * 调用方传入的 done 谓词应已应用 ExcludeSpec 改写（与 computeUnlocked 同款）。
 *
 * @param ids 节点 id 全集
 * @param edges 前置边（edge.to 必须是 ids 中存在的）
 * @param isDone done 谓词（含 ExcludeSpec 改写 + countable 处理）
 * @param isInactive 可选：判断节点是否为"非活跃"（shelved / abandoned）。
 *   非活跃节点不计入完成率/孤立/瓶颈的分母——长期放弃的目标不应持续扣分。
 *   不传则默认所有节点为活跃。
 */
export function analyzeGraph(
  ids: string[],
  edges: Edge[],
  isDone: (id: string, requiredCount: number) => boolean,
  isInactive?: (id: string) => boolean
): GraphAnalysis {
  const idSet = new Set(ids)
  const cycles = detectCycles(edges)
  const cycleNodes = new Set<string>()
  for (const c of cycles) for (const n of c) cycleNodes.add(n)

  // 统计 non-active 节点（shelved / abandoned）
  const inactiveCount = isInactive ? ids.filter((id) => isInactive(id)).length : 0

  // 入度 / 出度 / blocks（i → 我下游）
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  const blocksById = new Map<string, string[]>()
  const seenPairs = new Set<string>() // (r, e.to) 维度去重
  for (const id of ids) {
    inDeg.set(id, 0)
    outDeg.set(id, 0)
    blocksById.set(id, [])
  }

  for (const e of edges) {
    if (!idSet.has(e.to)) continue
    const refs = collectPrereqIds(e)
    for (const r of refs) {
      if (!idSet.has(r) || r === e.to) continue
      // 环上节点不计度（与 computeUnlocked 环处理一致：环上节点不参与解锁）
      if (cycleNodes.has(r) || cycleNodes.has(e.to)) continue
      // (r, e.to) 维度去重：多条 edge 重复指向同一对节点时只算一次
      const pairKey = `${r}->${e.to}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
      outDeg.set(r, (outDeg.get(r) ?? 0) + 1)
      blocksById.get(r)!.push(e.to)
    }
  }

  // blocks 去重（同一对节点被多条 edge 重复指向）
  for (const [k, v] of blocksById.entries()) {
    blocksById.set(k, [...new Set(v)])
  }

  // 构造 roles + 累计统计
  const roles = new Map<string, NodeRole>()
  let done = 0
  let totalInDeg = 0
  let totalOutDeg = 0
  for (const id of ids) {
    const idDone = isDone(id, 1)
    if (idDone) done++
    totalInDeg += inDeg.get(id) ?? 0
    totalOutDeg += outDeg.get(id) ?? 0
    roles.set(id, {
      id,
      inDegree: inDeg.get(id) ?? 0,
      outDegree: outDeg.get(id) ?? 0,
      isDone: idDone
    })
  }

  // 分类：孤儿 / 根 / 叶（环节点不入任何一类，与 detectCycles 配套）
  const orphans: string[] = []
  const roots: Array<NodeRole & { blocks: string[] }> = []
  const leaves: string[] = []
  for (const r of roles.values()) {
    if (cycleNodes.has(r.id)) continue
    if (r.inDegree === 0 && r.outDegree === 0) {
      orphans.push(r.id)
    } else if (r.inDegree === 0 && r.outDegree > 0) {
      roots.push({ ...r, blocks: blocksById.get(r.id) ?? [] })
    } else if (r.inDegree > 0 && r.outDegree === 0) {
      leaves.push(r.id)
    }
  }
  orphans.sort()
  leaves.sort()
  // 用 Unicode 码点排序（不用 localeCompare，避免 zh-CN 系统下中英混排顺序不稳定）
  roots.sort((a, b) => b.outDegree - a.outDegree || cmpId(a.id, b.id))

  // 瓶颈：未 done + 出度 > 0
  const allBottlenecks: Bottleneck[] = []
  for (const r of roles.values()) {
    if (r.isDone) continue
    if (r.outDegree === 0) continue
    allBottlenecks.push({
      id: r.id,
      score: r.outDegree,
      blocks: blocksById.get(r.id) ?? []
    })
  }
  allBottlenecks.sort((a, b) => b.score - a.score || cmpId(a.id, b.id))

  // critical path
  const { maxDepth, path } = computeCriticalPath(ids, edges, roles, cycleNodes)

  // 连通分量（不含孤立节点）
  const components = countComponents(ids, edges, cycleNodes)

  // 完成率 / 平均度
  // v2: 完成率分母 = activeTotal（剔除 shelved/abandoned）——长期放弃的目标不应持续扣分
  const total = ids.length
  const activeTotal = total - inactiveCount
  // 空图 / 全 inactive 时 completionRate 保持 0（保持原语义："无完成"）
  const completionRate = activeTotal === 0 ? 0 : done / activeTotal
  const avgInDegree = total === 0 ? 0 : totalInDeg / total
  const avgOutDegree = total === 0 ? 0 : totalOutDeg / total

  // 健康度评分（v2: 4 维度 100 分）
  // - 完成率 40（加分项，按 activeTotal 计算）
  // - 孤立 20（扣分项，每孤立 1 分；≥2 个孤立且比例 >20% 直接归 0——"图腐烂"信号）
  // - 瓶颈 25（扣分项，每瓶颈 2 分；≥2 个瓶颈且比例 >30% 直接归 0——"积压"信号）
  // - 深度 15（扣分项，maxDepth >5 开始每超 1 步扣 3 分——管理负担信号）
  const completionRateScore = Math.round(completionRate * 40)
  const orphanRate = activeTotal === 0 ? 0 : orphans.length / activeTotal
  let orphanScore = Math.max(0, 20 - orphans.length)
  // 单孤立不触发兜底(常见临时目标,温和扣 1 分);多孤立+高比例才归 0
  if (orphans.length >= 2 && orphanRate > 0.20) orphanScore = 0
  const bottleneckRate = activeTotal === 0 ? 0 : allBottlenecks.length / activeTotal
  let bottleneckScore = Math.max(0, 25 - allBottlenecks.length * 2)
  // 单瓶颈不触发兜底(只扣 2 分);多瓶颈+高比例才归 0
  if (allBottlenecks.length >= 2 && bottleneckRate > 0.30) bottleneckScore = 0
  const depthScore = Math.max(0, 15 - Math.max(0, maxDepth - 5) * 3)
  // 空图（无节点）/ 全部 shelved-abandoned（无可衡量）→ 满分；其余按四段子项求和
  const healthScore =
    total === 0 || activeTotal === 0
      ? 100
      : completionRateScore + orphanScore + bottleneckScore + depthScore

  return {
    stats: {
      total,
      done,
      completionRate,
      avgInDegree,
      avgOutDegree,
      maxDepth,
      components,
      activeTotal,
      inactiveCount
    },
    orphans,
    roots,
    leaves,
    bottlenecks: allBottlenecks.slice(0, 10),
    healthScore,
    healthBreakdown: {
      completionRateScore,
      orphanScore,
      bottleneckScore,
      depthScore,
      activeTotal,
      inactiveCount
    },
    criticalPath: path
  }
}

/**
 * 距离某节点的最近未完成前置步数。
 * 等价于 critical path DP 中该节点的 dist 值。
 * - target 已 done → 0
 * - target 是 root（无前置）→ 1（"这是第一步"）
 * - target 未完成 + 有未完成前置 → 1 + 最长未完成前置链步数
 */
export function distanceTo(
  targetId: string,
  ids: string[],
  edges: Edge[],
  isDone: (id: string, requiredCount: number) => boolean
): number {
  if (isDone(targetId, 1)) return 0
  const idSet = new Set(ids)
  if (!idSet.has(targetId)) return 0
  const cycles = detectCycles(edges)
  const cycleNodes = new Set<string>()
  for (const c of cycles) for (const n of c) cycleNodes.add(n)
  const roles = new Map<string, NodeRole>()
  for (const id of ids) {
    roles.set(id, {
      id,
      inDegree: 0,
      outDegree: 0,
      isDone: isDone(id, 1)
    })
  }
  const { dist } = computeCriticalPathWithDist(ids, edges, roles, cycleNodes)
  return dist.get(targetId) ?? 0
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 取一条 edge 的全部正向引用 id（来自 prerequisites + specs 中的 simple/group/count）。
 * exclude 不算正向引用（谓词改写已在调用方 isDone 里处理）。
 *
 * 这是 unlock.ts 私有 collectPrereqIds 的复刻（用 Set 而非 Array，
 * 内部去重更顺手）；语义对齐——同一对节点被多条 edge 重复指向时
 * analyze 自然按唯一引用算入度，避免 bottleneck / root 计数被夸大。
 */
function collectPrereqIds(edge: Edge): Set<string> {
  const set = new Set<string>()
  for (const p of edge.prerequisites) set.add(p)
  if (edge.specs) {
    for (const s of edge.specs) {
      if (s.kind === 'simple') {
        set.add(s.id)
      } else if (s.kind === 'group' || s.kind === 'count') {
        for (const m of s.members) {
          const id = typeof m === 'string' ? m : m.id
          set.add(id)
        }
      }
      // exclude 不参与正向引用
    }
  }
  return set
}

/**
 * 关键路径（最长未完成前置链）。
 * - done 节点折叠（distance = 0）
 * - 环上节点不参与（detectCycles 排除）
 * - maxDepth = 最深未完成链的步数（= 节点数）
 * - path = 该链的节点 id 列表（按 prereq → target 顺序）
 */
function computeCriticalPath(
  ids: string[],
  edges: Edge[],
  roles: Map<string, NodeRole>,
  cycleNodes: Set<string>
): { maxDepth: number; path: string[] } {
  const { dist, parent } = computeCriticalPathWithDist(ids, edges, roles, cycleNodes)
  let maxNode: string | null = null
  let maxD = 0
  for (const [n, d] of dist.entries()) {
    if (d > maxD) {
      maxD = d
      maxNode = n
    } else if (d === maxD && maxNode !== null && cmpId(n, maxNode) < 0) {
      maxNode = n
    }
  }
  const path: string[] = []
  if (maxNode !== null) {
    let cur: string | null = maxNode
    while (cur !== null) {
      path.unshift(cur)
      cur = parent.get(cur) ?? null
    }
  }
  return { maxDepth: maxD, path }
}

/**
 * DP 内部实现：算出每个节点的 dist（最长未完成前置链步数）和 parent（追溯用）。
 *
 * 拓扑排序沿正向（prereq → target）：
 *   - 入度 0 的是"起点"（root 或孤立的另一端），先入队
 *   - 出队时把下游节点的入度 -1，归零后再入队
 *
 * DP 沿拓扑序：
 *   - dist[n] = n 已 done ? 0 : 1 + max(dist[p] for p in n.prereqs and !p.done)
 *   - parent[n] = 给出 max 的那个 prereq（用于反推路径）
 *
 * 注：父链可能有多条同样长度的链，选其中任意一条；平手按 id 字典序小的优先。
 */
function computeCriticalPathWithDist(
  ids: string[],
  edges: Edge[],
  roles: Map<string, NodeRole>,
  cycleNodes: Set<string>
): { dist: Map<string, number>; parent: Map<string, string | null> } {
  const idSet = new Set(ids)
  const fwdAdj = new Map<string, string[]>()
  const revAdj = new Map<string, string[]>()
  for (const id of ids) {
    fwdAdj.set(id, [])
    revAdj.set(id, [])
  }
  for (const e of edges) {
    if (!idSet.has(e.to) || cycleNodes.has(e.to)) continue
    const refs = collectPrereqIds(e)
    for (const r of refs) {
      if (!idSet.has(r) || cycleNodes.has(r) || r === e.to) continue
      fwdAdj.get(r)!.push(e.to)
      revAdj.get(e.to)!.push(r)
    }
  }

  // 拓扑排序（Kahn）
  const inDeg = new Map<string, number>()
  for (const id of ids) inDeg.set(id, 0)
  for (const id of ids) {
    for (const m of fwdAdj.get(id) ?? []) {
      inDeg.set(m, (inDeg.get(m) ?? 0) + 1)
    }
  }
  const order: string[] = []
  const queue: string[] = []
  for (const [k, v] of inDeg.entries()) {
    if (v === 0) queue.push(k)
  }
  queue.sort()
  while (queue.length > 0) {
    const n = queue.shift()!
    order.push(n)
    for (const m of fwdAdj.get(n) ?? []) {
      const next = (inDeg.get(m) ?? 0) - 1
      inDeg.set(m, next)
      if (next === 0) {
        queue.push(m)
        queue.sort()
      }
    }
  }

  // DP
  const dist = new Map<string, number>()
  const parent = new Map<string, string | null>()
  for (const id of ids) {
    dist.set(id, 0)
    parent.set(id, null)
  }
  for (const n of order) {
    const role = roles.get(n)
    if (!role) continue
    // 环节点折叠：dist = 0（与 detectCycles 配套）
    if (cycleNodes.has(n)) {
      dist.set(n, 0)
      parent.set(n, null)
      continue
    }
    if (role.isDone) {
      dist.set(n, 0)
      continue
    }
    let maxD = 0
    let maxParent: string | null = null
    for (const p of revAdj.get(n) ?? []) {
      const pRole = roles.get(p)
      if (!pRole || pRole.isDone) continue
      const pd = dist.get(p) ?? 0
      if (pd > maxD) {
        maxD = pd
        maxParent = p
      } else if (pd === maxD && maxParent !== null && cmpId(p, maxParent) < 0) {
        maxParent = p
      }
    }
    dist.set(n, maxD + 1)
    parent.set(n, maxParent)
  }
  return { dist, parent }
}

/**
 * 连通分量计数（不含孤立节点）。
 * 把图看作无向（入度+出度任一非零的节点参与），BFS 数连通块。
 */
function countComponents(
  ids: string[],
  edges: Edge[],
  cycleNodes: Set<string>
): number {
  const idSet = new Set(ids)
  const adj = new Map<string, Set<string>>()
  for (const id of ids) adj.set(id, new Set())
  for (const e of edges) {
    if (!idSet.has(e.to) || cycleNodes.has(e.to)) continue
    const refs = collectPrereqIds(e)
    for (const r of refs) {
      if (!idSet.has(r) || cycleNodes.has(r) || r === e.to) continue
      adj.get(r)!.add(e.to)
      adj.get(e.to)!.add(r)
    }
  }
  const visited = new Set<string>()
  let count = 0
  for (const id of ids) {
    if (visited.has(id)) continue
    if (adj.get(id)!.size === 0) continue // 孤立节点不算"分量"
    count++
    const queue = [id]
    while (queue.length > 0) {
      const n = queue.shift()!
      if (visited.has(n)) continue
      visited.add(n)
      for (const m of adj.get(n) ?? []) {
        if (!visited.has(m)) queue.push(m)
      }
    }
  }
  return count
}

/**
 * 稳定的 id 比较器：纯 Unicode 码点比较。
 * 不依赖系统 locale，避免 zh-CN Windows 上中英混排顺序不稳定。
 * 返回 -1 / 0 / 1。
 */
function cmpId(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}