import type { Edge, UnlockResult } from './types'

/**
 * 给定条目 id 列表 + 关系 + 完成判定，计算每个条目是否解锁。
 * - isDone(id)：该条目是否算"已完成"（book: status==='finished'；goal: 自己的完成语义）
 * - 'all'：所有前置 done 才解锁
 * - 'any_of'：至少 threshold 个前置 done 才解锁
 * - 无前置：永远解锁
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
    edgeByTo.set(e.to, { ...e, prerequisites: prereqs })
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
    let ok: boolean
    // 优先二选一组合语义：必选项全部 done 且 每个组至少一个 done
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