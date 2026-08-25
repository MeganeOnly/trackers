import { create } from 'zustand'
import { api } from '../lib/api'
import type { Edge } from '@shared/types'

interface RelationsState {
  edges: Edge[]
  load: () => Promise<void>
  setAll: (edges: Edge[]) => Promise<void>
}

export const useRelationsStore = create<RelationsState>((set) => ({
  edges: [],
  load: async () => {
    try {
      const edges = await api.relations.get()
      set({ edges })
    } catch (e) {
      console.error('relations load failed:', e)
    }
  },
  setAll: async (edges) => {
    await api.relations.set(edges)
    set({ edges })
  }
}))
