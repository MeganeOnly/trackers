import { create } from 'zustand'
import { api } from '../lib/api'
import type { Config, WorkKind } from '@shared/types'

interface SettingsState {
  /** 新建作品的默认类型 */
  defaultWorkKind: WorkKind
  /** 展示筛选："all" 或某个 WorkKind */
  worksFilter: string
  hydrate: (cfg: Config) => void
  setDefaultWorkKind: (k: WorkKind) => Promise<void>
  setWorksFilter: (f: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  defaultWorkKind: 'book',
  worksFilter: 'all',
  hydrate: (cfg) =>
    set({
      defaultWorkKind: cfg.default_work_kind ?? 'book',
      worksFilter: cfg.works_filter || 'all'
    }),
  setDefaultWorkKind: async (k) => {
    const cfg = await api.config.set({ default_work_kind: k })
    set({ defaultWorkKind: cfg.default_work_kind })
  },
  setWorksFilter: async (f) => {
    const cfg = await api.config.set({ works_filter: f })
    set({ worksFilter: cfg.works_filter })
  }
}))