import { useGoalsStore } from './goals'
import { useRelationsStore } from './relations'
import { computeUnlocked } from '@core'
import { buildDonePredicate } from '@shared/done'
import type { Goal } from '@shared/types'

export function useUnlocked(): { unlocked: Map<string, boolean>; cycles: string[][] } {
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const { isDone } = buildDonePredicate(goals, edges)
  return computeUnlocked(
    goals.map((g) => g.id),
    edges,
    isDone
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
