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

/** 简单的多字段匹配：书名 / 作者 / ID 包含 query（不区分大小写） */
export function matchBook(book: { title: string; author: string; id: string }, q: string): boolean {
  if (!q) return true
  const lq = q.toLowerCase()
  return (
    book.title.toLowerCase().includes(lq) ||
    book.author.toLowerCase().includes(lq) ||
    book.id.toLowerCase().includes(lq)
  )
}
