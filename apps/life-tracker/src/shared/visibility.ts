// 日常模式『现在能推进的目标』可见性规则（纯函数，领域专属）。
//
// 规则：目标 G（not_started / in_progress）若存在任意一条沿「反向前置」
// 向上（G → 它解锁的上级 → 上级的上级 …）到达「未搁置且未放弃」目标的路径，
// 则 G 仍显示；若 G 有上级、且所有向上路径都终止于搁置/放弃目标，则隐藏 G。
// - 搁置 / 放弃节点视为「死路」；无上级的顶层节点视为「活路」
// - G 解锁多个上级时，只要有一个仍活跃就显示
// - 环：访问中先置 memo=false，环内节点保守视为活路，不隐藏
//
// 纯展示层：不影响解锁计算与状态机。

import type { Edge, Goal } from './types'

function isDeadStatus(g: Goal): boolean {
  return g.status === 'shelved' || g.status === 'abandoned'
}

/**
 * 返回「因上级被搁置/放弃而应从日常可推进列表隐藏」的目标 id 集合。
 */
export function computeDailyHidden(goals: Goal[], edges: Edge[]): Set<string> {
  const byId = new Map(goals.map((g) => [g.id, g]))
  const parents = new Map<string, string[]>()
  for (const g of goals) parents.set(g.id, [])
  // 反向前置：prerequisite → 它解锁的目标(e.to)
  for (const e of edges) {
    if (!byId.has(e.to)) continue
    for (const p of e.prerequisites) {
      if (byId.has(p)) parents.get(p)!.push(e.to)
    }
  }

  const memo = new Map<string, boolean>()
  // dead(id) = id 的向上路径全部死路（自身被搁置/放弃，或所有上级都死路）
  const dead = (id: string): boolean => {
    const g = byId.get(id)
    if (!g) return true
    if (isDeadStatus(g)) return true
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const ps = parents.get(id) ?? []
    if (ps.length === 0) return false // 顶层：活路
    memo.set(id, false) // 环防护：探索中先按活路
    const allDead = ps.every(dead)
    memo.set(id, allDead)
    return allDead
  }

  const blocked = new Set<string>()
  for (const g of goals) {
    if (g.status === 'not_started' || g.status === 'in_progress') {
      if (dead(g.id)) blocked.add(g.id)
    }
  }
  return blocked
}
