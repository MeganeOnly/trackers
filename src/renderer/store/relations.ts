import { create } from 'zustand'
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
      const edges = await window.electron.relations.get()
      set({ edges })
    } catch (e) {
      console.error('relations load failed:', e)
    }
  },
  setAll: async (edges) => {
    await window.electron.relations.set(edges)
    set({ edges })
  }
}))
