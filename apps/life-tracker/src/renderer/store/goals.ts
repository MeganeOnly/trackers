import { create } from 'zustand'
import { api } from '../lib/api'
import type { Goal, GoalInput } from '@shared/types'

interface GoalsState {
  goals: Goal[]
  broken: { id: string; error: string }[]
  selectedId: string | null
  loading: boolean
  load: () => Promise<void>
  select: (id: string | null) => void
  create: (input: GoalInput) => Promise<Goal>
  update: (id: string, patch: Partial<GoalInput>) => Promise<Goal>
  bumpProgress: (id: string, delta: number) => Promise<Goal>
  remove: (id: string) => Promise<void>
}

export const useGoalsStore = create<GoalsState>((set) => ({
  goals: [],
  broken: [],
  selectedId: null,
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      const { goals, broken } = await api.goals.list()
      set({ goals, broken, loading: false })
    } catch (e) {
      console.error('goals load failed:', e)
      set({ loading: false })
    }
  },
  select: (id) => set({ selectedId: id }),
  create: async (input) => {
    const goal = await api.goals.create(input)
    set((s) => ({ goals: [...s.goals, goal] }))
    return goal
  },
  update: async (id, patch) => {
    const goal = await api.goals.update(id, patch)
    set((s) => ({ goals: s.goals.map((b) => (b.id === id ? goal : b)) }))
    return goal
  },
  bumpProgress: async (id, delta) => {
    const goal = await api.goals.progressBump(id, delta)
    set((s) => ({ goals: s.goals.map((b) => (b.id === id ? goal : b)) }))
    return goal
  },
  remove: async (id) => {
    await api.goals.delete(id)
    set((s) => ({
      goals: s.goals.filter((b) => b.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId
    }))
  }
}))
