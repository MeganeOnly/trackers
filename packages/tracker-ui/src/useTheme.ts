// packages/tracker-ui/src/useTheme.ts
//
// Theme + Format 双维度 hook —— 把当前 theme / format 应用到
// document.documentElement[data-theme] / [data-format]。
// 两个维度正交,组合出 3 × 3 = 9 种 preset。
//
// 启动时由 main.tsx 调用 applyInitialTheme/Format(hydrated),后续切换由
// SettingsPanel 调用 setTheme/setFormat。
//
// 设计要点:
// 1. 用 data-theme + data-format 两个属性,CSS :root[data-theme="..."] /
//    :root[data-format="..."] 选择器分别切换样式风格 / 格式风格
// 2. theme / format 各自持久化(在 Config.theme / Config.format),不在共享包管
// 3. 默认 classic + list —— 即使 hydrate 失败也保证 UI 不闪

export const DEFAULT_THEME = 'classic' as const
export const DEFAULT_FORMAT = 'list' as const

export type ThemeName = 'classic' | 'library' | 'codex'
export type FormatName = 'list' | 'grid' | 'focus-stack'

export const ALL_THEMES: ThemeName[] = ['classic', 'library', 'codex']
export const ALL_FORMATS: FormatName[] = ['list', 'grid', 'focus-stack']

export interface ThemeMeta {
  id: ThemeName
  label: string
  /** 一句话说明 */
  hint: string
  /** 用于 settings panel 色卡预览的 accent hex */
  accentHex: string
  /** 用于 settings panel 色卡预览的 bg hex */
  bgHex: string
}

export const THEME_META: Record<ThemeName, ThemeMeta> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    hint: '当前样式 · sage green + 圆角',
    accentHex: '#4a7c59',
    bgHex: '#fafaf8'
  },
  library: {
    id: 'library',
    label: 'Library',
    hint: '深森林绿 · Fraunces · 书架感',
    accentHex: '#1f3a2e',
    bgHex: '#f4f2ec'
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    hint: '朱砂红 · Fraunces · 印章感',
    accentHex: '#5a2418',
    bgHex: '#f5f1e8'
  }
}

export interface FormatMeta {
  id: FormatName
  label: string
  /** 一句话说明 */
  hint: string
  /** 简短 ASCII wireframe 预览(settings panel 用) */
  wireframe: string
}

export const FORMAT_META: Record<FormatName, FormatMeta> = {
  list: {
    id: 'list',
    label: '紧凑列表',
    hint: '默认 · 文字流 · 密度高',
    wireframe: '│ ① ② ③\n│ ─────\n│ ④ ⑤'
  },
  grid: {
    id: 'grid',
    label: '卡片墙',
    hint: 'CSS grid · 视觉独立 · 适合浏览',
    wireframe: '┌──┐┌──┐┌──┐\n│  ││  ││  │\n└──┘└──┘└──┘'
  },
  'focus-stack': {
    id: 'focus-stack',
    label: '焦点 + 印章墙',
    hint: '顶部焦点卡 · 中部清单 · 底部印章墙',
    wireframe: '┌─ 焦点 ─┐\n│ ████  │\n├────────┤\n│ ① ②   │\n├────────┤\n│ ✓ ✓ ✓ │'
  }
}

/** 验证 theme 字符串是否合法,非法 fallback 到 classic */
export function normalizeTheme(s: string | undefined | null): ThemeName {
  if (s === 'classic' || s === 'library' || s === 'codex') return s
  return DEFAULT_THEME
}

/** 验证 format 字符串是否合法,非法 fallback 到 list */
export function normalizeFormat(s: string | undefined | null): FormatName {
  if (s === 'list' || s === 'grid' || s === 'focus-stack') return s
  return DEFAULT_FORMAT
}

/** 在 documentElement 上设置 data-theme;无副作用、可重复调用 */
export function applyTheme(name: ThemeName): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = name
}

/** 在 documentElement 上设置 data-format */
export function applyFormat(name: FormatName): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.format = name
}

/**
 * 启动时调一次,带 hydrate 出来的 theme 名。空值 fallback classic。
 * 不会抛错——即使 document 还没准备好也安全。
 */
export function applyInitialTheme(name: string | undefined | null): void {
  applyTheme(normalizeTheme(name))
}

export function applyInitialFormat(name: string | undefined | null): void {
  applyFormat(normalizeFormat(name))
}
