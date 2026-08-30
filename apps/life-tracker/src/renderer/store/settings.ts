import { create } from 'zustand'
import { api } from '../lib/api'
import { applyTheme, applyFormat, normalizeTheme, normalizeFormat } from '@ui/useTheme'
import type { ThemeName, FormatName } from '@ui/useTheme'
import type { Config } from '@shared/types'

interface SettingsState {
  /** 视觉主题预设(样式风格 —— accent/font/radius/shadow) */
  theme: ThemeName
  /** 信息呈现格式(格式风格 —— list/grid/focus-stack,与 theme 正交) */
  format: FormatName
  hydrate: (cfg: Config) => void
  setTheme: (name: ThemeName) => Promise<void>
  setFormat: (name: FormatName) => Promise<void>
}

const THEME_LS_KEY = 'tracker-theme'
const FORMAT_LS_KEY = 'tracker-format'

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
  theme: 'classic',
  format: 'list',
  hydrate: (cfg) => {
    const t = normalizeTheme(cfg.theme)
    const f = normalizeFormat(cfg.format)
    persistThemeLS(t)
    persistFormatLS(f)
    applyTheme(t)
    applyFormat(f)
    set({ theme: t, format: f })
  },
  setTheme: async (name) => {
    const t = normalizeTheme(name)
    persistThemeLS(t)
    applyTheme(t)
    set({ theme: t })
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
  }
}))
