import type { Book, Edge, UnlockResult } from './types'

/**
 * 给定书列表 + 关系，计算每本书是否解锁。
 * - status === 'finished' 才算"已读"
 * - 'all'：所有前置 finished 才解锁
 * - 'any_of'：至少 threshold 个前置 finished 才解锁
 * - 无前置：永远解锁
 *
 * 返回 unlocked map 和循环依赖列表（环上的书不参与解锁计算，置 false）。
 */
export function computeUnlocked(books: Book[], edges: Edge[]): UnlockResult {
  const unlocked = new Map<string, boolean>()
  const bookIds = new Set(books.map((b) => b.id))

  // 1. 检测循环依赖
  const cycles = detectCycles(edges)
  const cycleNodes = new Set<string>()
  for (const cycle of cycles) for (const id of cycle) cycleNodes.add(id)

  // 2. 计算每本书的前置边
  const edgeByTo = new Map<string, Edge>()
  for (const e of edges) {
    // 过滤悬空引用
    const prereqs = e.prerequisites.filter((p) => bookIds.has(p))
    edgeByTo.set(e.to, { ...e, prerequisites: prereqs })
  }

  const finished = (id: string): boolean =>
    books.find((b) => b.id === id)?.status === 'finished'

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
    const done = edge.prerequisites.filter(finished).length
    const ok =
      edge.rule === 'all'
        ? done === edge.prerequisites.length
        : done >= (edge.threshold ?? edge.prerequisites.length)
    unlocked.set(id, ok)
    return ok
  }

  for (const b of books) unlockedOf(b.id)
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
