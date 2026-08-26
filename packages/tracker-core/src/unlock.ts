import type { Edge, ExcludeSpec, PrereqSpec, UnlockResult } from './types'

/**
 * 给定条目 id 列表 + 关系 + 完成判定，计算每个条目是否解锁。
 * - isDone(id)：该条目是否算"已完成"（book: status==='finished'；goal: 自己的完成语义）。
 *   应用层拿到原始 done 谓词后，应先用所有 `exclude` 改写一遍（`disqualifies` → 失格，
 *   `satisfies` → 视为 done），再传入本函数。
 * - 'all'：所有前置 done 才解锁
 * - 'any_of'：至少 threshold 个前置 done 才解锁
 * - 无前置：永远解锁
 *
 * 优先级（v2）：
 *   1. `edge.specs` 含正向 spec → 用 AND-of-specs 解锁；
 *      specs 里的 `exclude` 仅作为占位记录，谓词改写在应用层完成。
 *   2. 否则若 `edge.groups` 非空 → 用旧 AND-of-ORs 路径；
 *   3. 否则按 `rule + threshold` 路径。
 *
 * 返回 unlocked map 和循环依赖列表（环上的条目不参与解锁计算，置 false）。
 */
export function computeUnlocked(
  ids: string[],
  edges: Edge[],
  isDone: (id: string) => boolean
): UnlockResult {
  const unlocked = new Map<string, boolean>()
  const idSet = new Set(ids)

  // 1. 检测循环依赖
  const cycles = detectCycles(edges)
  const cycleNodes = new Set<string>()
  for (const cycle of cycles) for (const id of cycle) cycleNodes.add(id)

  // 2. 计算每条前置边（过滤悬空引用）
  const edgeByTo = new Map<string, Edge>()
  for (const e of edges) {
    const prereqs = e.prerequisites.filter((p) => idSet.has(p))
    const specs = e.specs?.filter((s) => s.kind !== 'exclude')
    const filteredSpecs = specs && specs.length > 0 ? specs : undefined
    edgeByTo.set(e.to, {
      ...e,
      prerequisites: prereqs,
      specs: filteredSpecs,
      groups: e.groups && e.groups.length > 0 ? e.groups : undefined
    })
  }

  // 3. 迭代解锁（带 memo）
  function unlockedOf(id: string): boolean {
    if (unlocked.has(id)) return unlocked.get(id)!
    if (cycleNodes.has(id)) {
      unlocked.set(id, false)
      return false
    }
    const edge = edgeByTo.get(id)
    if (!edge || edge.prerequisites.length === 0) {
      unlocked.set(id, true)
      return true
    }
    // v2 specs 路径（AND-of-specs）
    if (edge.specs && edge.specs.length > 0) {
      const ok = edge.specs.every((spec) => isSpecSatisfied(spec, isDone))
      unlocked.set(id, ok)
      return ok
    }
    let ok: boolean
    // 旧二选一组合语义：必选项全部 done 且 每个组至少一个 done
    if (edge.groups && edge.groups.length > 0) {
      const inGroup = new Set(edge.groups.flat())
      const mandatoryOk = edge.prerequisites
        .filter((p) => !inGroup.has(p))
        .every(isDone)
      const groupsOk = edge.groups.every((g) => g.some(isDone))
      ok = mandatoryOk && groupsOk
    } else {
      const done = edge.prerequisites.filter(isDone).length
      ok =
        edge.rule === 'all'
          ? done === edge.prerequisites.length
          : done >= (edge.threshold ?? edge.prerequisites.length)
    }
    unlocked.set(id, ok)
    return ok
  }

  for (const id of ids) unlockedOf(id)
  return { unlocked, cycles }
}

/**
 * 单个 spec 是否『满足』（exclude 在此永真，由谓词改写处理）。
 */
function isSpecSatisfied(spec: PrereqSpec, isDone: (id: string) => boolean): boolean {
  switch (spec.kind) {
    case 'simple':
      return isDone(spec.id)
    case 'group': {
      const pick = spec.pick ?? 1
      let hit = 0
      for (const m of spec.members) if (isDone(m)) hit++
      return hit >= pick
    }
    case 'count': {
      let hit = 0
      for (const m of spec.members) if (isDone(m)) hit++
      return hit >= spec.need
    }
    case 'exclude':
      // exclude 不参与正向 AND 计数；谓词已经在 isDone 里改写。
      return true
  }
}

/**
 * 收集所有 edges 中出现的 ExcludeSpec 索引（去重，按 `trigger|target|effect`）。
 * 用于应用层构建 done 谓词的『改写层』。
 */
export function collectExcludes(edges: Edge[]): ExcludeSpec[] {
  const seen = new Set<string>()
  const out: ExcludeSpec[] = []
  for (const e of edges) {
    const list = [...(e.excludes ?? []), ...(e.specs?.filter((s) => s.kind === 'exclude') ?? [])]
    for (const x of list) {
      const key = `${x.trigger}|${x.target}|${x.effect}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(x)
    }
  }
  return out
}

/** DFS 检测循环，返回每个环涉及到的节点 id 列表（去重合并） */
export function detectCycles(edges: Edge[]): string[][] {
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    // 前置 -> 后置（有向：A 是 B 的前置则 B 依赖 A → 边 A -> B）
    for (const prereq of e.prerequisites) {
      if (!adj.has(prereq)) adj.set(prereq, [])
      adj.get(prereq)!.push(e.to)
    }
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const cycles: string[][] = []

  function dfs(node: string): void {
    const c = color.get(node) ?? WHITE
    if (c === GRAY) {
      // 找到环：从 stack 里截取
      const idx = stack.indexOf(node)
      if (idx >= 0) cycles.push(stack.slice(idx).concat(node))
      return
    }
    if (c === BLACK) return
    color.set(node, GRAY)
    stack.push(node)
    for (const next of adj.get(node) ?? []) dfs(next)
    stack.pop()
    color.set(node, BLACK)
  }

  for (const node of adj.keys()) dfs(node)
  return cycles
}