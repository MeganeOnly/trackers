import { useShallow } from 'zustand/react/shallow'
import { useGoalsStore } from './goals'
import { useRelationsStore } from './relations'
import { computeUnlocked } from '@core'
import { buildDonePredicate } from '@shared/done'
import type { Goal, Edge } from '@shared/types'

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

export function useBackReferences(): Map<string, Goal[]> {
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const byId = new Map(goals.map((g) => [g.id, g]))
  const back = new Map<string, Goal[]>()
  for (const e of edges) {
    for (const prereqId of e.prerequisites) {
      if (!back.has(prereqId)) back.set(prereqId, [])
      const target = byId.get(e.to)
      if (target) back.get(prereqId)!.push(target)
    }
  }
  return back
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

export function useEdgeFor(goalId: string | null): Edge | null {
  const edges = useRelationsStore(useShallow((s) => s.edges))
  if (!goalId) return null
  return edges.find((e) => e.to === goalId) ?? null
}
