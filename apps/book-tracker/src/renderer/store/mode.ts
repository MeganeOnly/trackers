import { create } from 'zustand'
import type { Config } from '@shared/types'

type Mode = 'clean' | 'edit'

interface ModeState {
  mode: Mode
  setMode: (m: Mode) => void
  toggle: () => void
  hydrate: (cfg: Config) => void
}

export const useModeStore = create<ModeState>((set) => ({
  mode: 'clean',
  setMode: (m) => set({ mode: m }),
  toggle: () => set((s) => ({ mode: s.mode === 'clean' ? 'edit' : 'clean' })),
  hydrate: (cfg) => set({ mode: cfg.default_mode })
}))
