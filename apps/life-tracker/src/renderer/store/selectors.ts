import { useMemo } from 'react'
import { useGoalsStore } from './goals'
import { useRelationsStore } from './relations'
import { analyzeGraph, computeBlockingRelations, computeUnlocked } from '@core'
import type { BlockingRelation, GraphAnalysis } from '@core'
import { buildDonePredicate } from '@shared/done'
import type { Goal } from '@shared/types'

export function useUnlocked(): {
  unlocked: Map<string, boolean>
  cycles: string[][]
  /** 每个 id 的直接双向邻居：blocks（我解锁后能推动谁）/ blockedBy（还卡在谁上） */
  relations: Map<string, BlockingRelation>
} {
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const { isDone } = buildDonePredicate(goals, edges)
  const unlocked = computeUnlocked(
    goals.map((g) => g.id),
    edges,
    isDone
  )
  const relations = useMemo(() => computeBlockingRelations(edges), [edges])
  return { ...unlocked, relations }
}

/**
 * Unlock 图健康度分析 —— useUnlocked 的兄弟 hook。
 * 走同款 buildDonePredicate（含 ExcludeSpec 改写 + countable 处理），
 * 不重复实现谓词改写逻辑。
 *
 * 返回的 GraphAnalysis 是纯计算视图，不写盘、不修改 store；
 * UI 可以直接拿来渲染（孤立节点列表 / 瓶颈 top 10 / 健康度评分等）。
 *
 * v2 健康度算法：完成率分母剔除 shelved/abandoned（避免"放弃的目标"持续扣分）。
 */
export function useGraphAnalysis(): GraphAnalysis {
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const { isDone } = buildDonePredicate(goals, edges)
  return useMemo(
    () =>
      analyzeGraph(
        goals.map((g) => g.id),
        edges,
        isDone,
        // shelved / abandoned 视为"非活跃",不计入健康度分母（v2 起）
        (id) => {
          const g = goals.find((x) => x.id === id)
          return !!g && (g.status === 'shelved' || g.status === 'abandoned')
        }
      ),
    [goals, edges, isDone]
  )
}

export function useGroupedByStatus(): Record<Goal['status'], Goal[]> {
  const goals = useGoalsStore((s) => s.goals)
  const groups: Record<Goal['status'], Goal[]> = {
    not_started: [],
    in_progress: [],
    done: [],
    shelved: [],
    abandoned: []
  }
  for (const g of goals) groups[g.status].push(g)
  for (const k of Object.keys(groups) as Goal['status'][]) {
    groups[k].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }
  return groups
}
