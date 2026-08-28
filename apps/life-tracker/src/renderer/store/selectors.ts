import { useMemo } from 'react'
import { useGoalsStore } from './goals'
import { useRelationsStore } from './relations'
import { computeBlockingRelations, computeUnlocked } from '@core'
import type { BlockingRelation } from '@core'
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
