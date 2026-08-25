import { create } from 'zustand'

interface SearchState {
  query: string
  set: (q: string) => void
  clear: () => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  set: (q) => set({ query: q }),
  clear: () => set({ query: '' })
}))

/** 简单的多字段匹配：目标名称 / 分类 / ID 包含 query（不区分大小写） */
export function matchGoal(goal: { title: string; category: string; id: string }, q: string): boolean {
  if (!q) return true
  const lq = q.toLowerCase()
  return (
    goal.title.toLowerCase().includes(lq) ||
    goal.category.toLowerCase().includes(lq) ||
    goal.id.toLowerCase().includes(lq)
  )
}
