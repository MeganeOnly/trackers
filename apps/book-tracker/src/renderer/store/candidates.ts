import { create } from 'zustand'
import { api } from '../lib/api'
import { useBooksStore } from './books'
import type { Candidate, PromoteStatus } from '@shared/types'

interface CandidatesState {
  items: Candidate[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
  add: (title: string, tags: string[], note?: string) => Promise<Candidate>
  remove: (id: string) => Promise<void>
  /** promote 后会自动 remove，调用方需要自行刷新 books store */
  promote: (id: string, status: PromoteStatus) => Promise<void>
}

export const useCandidatesStore = create<CandidatesState>((set) => ({
  items: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null })
    try {
      const items = await api.candidates.list()
      set({ items, loading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false })
    }
  },
  add: async (title, tags, note) => {
    const c = await api.candidates.add(title, tags, note)
    set((s) => {
      // 标题查重已在 service 层做（service 返回已有），这里 upsert
      const others = s.items.filter((x) => x.id !== c.id)
      return { items: [c, ...others] }
    })
    return c
  },
  remove: async (id) => {
    await api.candidates.remove(id)
    set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
  },
  promote: async (id, status) => {
    await api.candidates.promote(id, status)
    set((s) => ({ items: s.items.filter((x) => x.id !== id) }))
    // promote 在 Rust 端已 create_book；这里刷新 books store 让 UI 同步
    await useBooksStore.getState().load()
  }
}))
