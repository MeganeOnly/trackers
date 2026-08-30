// packages/tracker-ui/src/index.ts
//
// 共享 UI 基座 —— 两 app 都能从这里 import:
//   import { Modal } from '@ui/Modal'
//   import { StampChip } from '@ui/StampChip'
//   import { applyInitialTheme, applyInitialFormat, ALL_THEMES, ALL_FORMATS,
//            THEME_META, FORMAT_META, normalizeTheme, normalizeFormat } from '@ui/useTheme'
//   import { GraphView } from '@ui/GraphView'
//   import type { ThemeName, FormatName, ThemeMeta, FormatMeta } from '@ui/useTheme'
//
// CSS 由 main.tsx 显式 import:
//   import '@ui/base.css'
//   import '@ui/GraphView.css'      // 共享 GraphView 样式（.graph-view / .graph-legend）
//   import '@ui/themes/classic.css' // 当前 theme
//   import '@ui/formats/grid.css'   // 当前 format(可选;list 是 base.css 内置)
//
// 不在 index.ts 里 re-export css —— Vite alias 解析更稳定。

export { Modal } from './Modal'
export { StampChip } from './StampChip'
export {
  DEFAULT_THEME,
  DEFAULT_FORMAT,
  ALL_THEMES,
  ALL_FORMATS,
  THEME_META,
  FORMAT_META,
  normalizeTheme,
  normalizeFormat,
  applyTheme,
  applyFormat,
  applyInitialTheme,
  applyInitialFormat
} from './useTheme'
export type { ThemeName, FormatName, ThemeMeta, FormatMeta } from './useTheme'

export { GraphView } from './GraphView'
export type {
  GraphViewProps,
  LayoutMode,
  NodeDecorationFn
} from './GraphView'
export type { BaseGraphNode, BaseGraphLink } from './GraphView'
export {
  useGraphPhysics,
  DEFAULT_MOTION,
  applyTreeLayout,
  computeDepths,
  DEFAULT_TREE_DIMS,
  useAutoCenter,
  drawTagChips,
  useResize
} from './GraphView'
export type {
  MotionRef,
  PhysicsController,
  TreeLayoutDims,
  Dims
} from './GraphView'
