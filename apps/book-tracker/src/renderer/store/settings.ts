import { create } from 'zustand'
import { api } from '../lib/api'
import { applyTheme, applyFormat, normalizeTheme, normalizeFormat } from '@ui/useTheme'
import type { ThemeName, FormatName } from '@ui/useTheme'
import type { Config, SidebarSeriesEntryMode, WorkKind } from '@shared/types'

interface SettingsState {
  /** 新建作品的默认类型 */
  defaultWorkKind: WorkKind
  /** 展示筛选："all" 或某个 WorkKind */
  worksFilter: string
  /** 视觉主题预设(样式风格 —— accent/font/radius/shadow) */
  theme: ThemeName
  /** 信息呈现格式(格式风格 —— list/grid/focus-stack,与 theme 正交) */
  format: FormatName
  /** 侧栏系列入口展示模式(v2.x 起;当前固定 inline-row,留扩展位) */
  sidebarSeriesEntryMode: SidebarSeriesEntryMode
  hydrate: (cfg: Config) => void
  setDefaultWorkKind: (k: WorkKind) => Promise<void>
  setWorksFilter: (f: string) => Promise<void>
  setTheme: (name: ThemeName) => Promise<void>
  setFormat: (name: FormatName) => Promise<void>
  setSidebarSeriesEntryMode: (m: SidebarSeriesEntryMode) => Promise<void>
}

const THEME_LS_KEY = 'tracker-theme'
const FORMAT_LS_KEY = 'tracker-format'

/** 把 Config.sidebar_series_entry_mode 容错规整成已知 SidebarSeriesEntryMode(v2.x 起)。 */
function normalizeSidebarSeriesEntryMode(s: string | undefined): SidebarSeriesEntryMode {
  if (s === 'inline-row') return 'inline-row'
  return 'inline-row'
}

function persistThemeLS(name: ThemeName): void {
  try {
    localStorage.setItem(THEME_LS_KEY, name)
  } catch {
    /* 隐私模式忽略 */
  }
}
function persistFormatLS(name: FormatName): void {
  try {
    localStorage.setItem(FORMAT_LS_KEY, name)
  } catch {
    /* 隐私模式忽略 */
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  defaultWorkKind: 'book',
  worksFilter: 'all',
  theme: 'classic',
  format: 'list',
  sidebarSeriesEntryMode: 'inline-row',
  hydrate: (cfg) => {
    const t = normalizeTheme(cfg.theme)
    const f = normalizeFormat(cfg.format)
    persistThemeLS(t)
    persistFormatLS(f)
    applyTheme(t)
    applyFormat(f)
    set({
      defaultWorkKind: cfg.default_work_kind ?? 'book',
      worksFilter: cfg.works_filter || 'all',
      theme: t,
      format: f,
      sidebarSeriesEntryMode: normalizeSidebarSeriesEntryMode(cfg.sidebar_series_entry_mode)
    })
  },
  setDefaultWorkKind: async (k) => {
    const cfg = await api.config.set({ default_work_kind: k })
    set({ defaultWorkKind: cfg.default_work_kind })
  },
  setWorksFilter: async (f) => {
    const cfg = await api.config.set({ works_filter: f })
    set({ worksFilter: cfg.works_filter })
  },
  setTheme: async (name) => {
    const t = normalizeTheme(name)
    // 立即同步:本地状态 + DOM data-theme + localStorage(防 FOUC 用)
    persistThemeLS(t)
    applyTheme(t)
    set({ theme: t })
    // 持久化到 config.json(失败时不回滚 UI —— 用户手动切回即可,避免无网络盘时阻塞)
    try {
      const cfg = await api.config.set({ theme: t })
      const stored = normalizeTheme(cfg.theme)
      if (stored !== t) {
        persistThemeLS(stored)
        applyTheme(stored)
        set({ theme: stored })
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('settings.setTheme: persist failed, UI-only', e)
    }
  },
  setFormat: async (name) => {
    const f = normalizeFormat(name)
    persistFormatLS(f)
    applyFormat(f)
    set({ format: f })
    try {
      const cfg = await api.config.set({ format: f })
      const stored = normalizeFormat(cfg.format)
      if (stored !== f) {
        persistFormatLS(stored)
        applyFormat(stored)
        set({ format: stored })
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('settings.setFormat: persist failed, UI-only', e)
    }
  },
  // v2.x 侧栏系列入口展示模式 —— 当前固定 inline-row,留扩展位
  setSidebarSeriesEntryMode: async (m) => {
    const normalized = normalizeSidebarSeriesEntryMode(m)
    // 立即同步本地状态 —— BookList 重新渲染会用到;没有 DOM class 副作用
    set({ sidebarSeriesEntryMode: normalized })
    // 持久化到 config.json(失败时不回滚 UI,跟 setTheme/setFormat 同款精神)
    try {
      const cfg = await api.config.set({ sidebar_series_entry_mode: normalized })
      const stored = normalizeSidebarSeriesEntryMode(cfg.sidebar_series_entry_mode)
      if (stored !== normalized) {
        set({ sidebarSeriesEntryMode: stored })
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('settings.setSidebarSeriesEntryMode: persist failed, UI-only', e)
    }
  }
}))
