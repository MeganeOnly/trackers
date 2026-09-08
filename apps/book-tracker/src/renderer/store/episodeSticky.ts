// 集笔记便签浮窗 —— 全局 UI 状态(v2.x 新增)。
//
// 职责:
// - 持有浮窗 open / 位置 / 当前选中的作品 + 季 + 集
// - localStorage 持久化(跟 settings.theme / settings.format 同款,非 config.json,
//   避免污染数据仓)
// - 不持有 stamps 草稿 —— stamps 直接从 useBooksStore 读 / 走 store action 写
//   (走 v2.x 治本模式:StampList 自带 notesDirty + lastSentRef 保护)
//
// 数据语义:
// - `kind: 'episode' | 'movie'` —— episode 走 stamps = book.episodes[key].stamps,
//   movie 走 stamps = book.stamps;互斥(同时只显示一种)
// - `selectedSeason` / `selectedEpisode` —— movie 模式下都为 0(无意义占位),
//   episode 模式下 1-based(跟 EpisodeRecord 语义一致)
//
// localStorage 约定:
// - `tracker-episode-sticky-position` —— `{x, y}` 浮窗左上角坐标
// - `tracker-episode-sticky-selection` —— `{bookId, kind, season, episode}`
// - `open` 状态**不**持久化(用户期望重启 App 后浮窗是关的;跟 theme/format
//   启动时 hydrate 不同 —— 那些是视觉持久化,浮窗是临时 overlay)

import { create } from 'zustand'

const POSITION_LS_KEY = 'tracker-episode-sticky-position'
const SELECTION_LS_KEY = 'tracker-episode-sticky-selection'

/** 浮窗位置默认值:右上角,避开 TopBar(top: 80px, right: 80px → x 由视口宽度反推在 hydrate 时算) */
const DEFAULT_POSITION = { x: -1, y: 80 } // x=-1 表示「由 hydrate 时按 viewport 计算」

export type StickyKind = 'episode' | 'movie'

export interface StickyPosition {
  x: number
  y: number
}

export interface StickySelection {
  bookId: string
  kind: StickyKind
  season: number
  episode: number
}

interface EpisodeStickyState {
  open: boolean
  position: StickyPosition
  selectedBookId: string | null
  selectedKind: StickyKind | null
  selectedSeason: number
  selectedEpisode: number
  /** 是否已 hydrate 过(防止重复 hydrate 覆盖用户实时操作) */
  hydrated: boolean

  // -------- actions --------
  toggle: () => void
  setOpen: (open: boolean) => void
  setPosition: (pos: StickyPosition) => void
  /**
   * 选作品 + 自动跳到该书的「合理默认季/集」。
   * - tv / anime(kind='episode')→ season=1, episode=1
   * - movie(kind='movie')→ season=0, episode=0(无意义占位,UI 不显示「01」位)
   *
   * 注意:这里**不**校验 book 是否存在(由调用方保证);校验逻辑放在 UI 层
   * (避免 store 依赖 books 列表 —— 渲染时 books 列表可能还没加载)
   */
  selectBook: (id: string, kind: StickyKind) => void
  /** 选集(movie 模式下不调);season / episode 都是 1-based */
  selectEpisode: (season: number, episode: number) => void
  /** 清空选中(作品被删后 UI 调用) */
  clearSelection: () => void
  /** 从 localStorage 恢复 position + selection;幂等,只跑一次 */
  hydrate: () => void
}

/** localStorage 读 + 容错:坏 JSON / 缺字段 → 返回 null(调用方用默认值) */
function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed as T
  } catch {
    // 坏 JSON / 隐私模式 → 清掉坏 key + 返回 null
    try { localStorage.removeItem(key) } catch { /* ignore */ }
    return null
  }
}

/** localStorage 写 + 容错:隐私模式 / 配额满 → 静默吞掉 */
function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式 / 配额满:浮窗仍能用,只是下次启动不恢复位置/选中 —— 静默吞
  }
}

function isValidPosition(p: unknown): p is StickyPosition {
  if (typeof p !== 'object' || p === null) return false
  const pos = p as { x?: unknown; y?: unknown }
  return typeof pos.x === 'number' && typeof pos.y === 'number'
}

function isValidSelection(s: unknown): s is StickySelection {
  if (typeof s !== 'object' || s === null) return false
  const sel = s as { bookId?: unknown; kind?: unknown; season?: unknown; episode?: unknown }
  return (
    typeof sel.bookId === 'string' &&
    (sel.kind === 'episode' || sel.kind === 'movie') &&
    typeof sel.season === 'number' &&
    typeof sel.episode === 'number'
  )
}

/** clamp position 到 viewport 范围内,避免拖到屏外丢失 */
function clampPosition(pos: StickyPosition, viewportW: number, viewportH: number): StickyPosition {
  // 浮窗尺寸估约 360x300;clamp 时留 8px 边距
  const W = 360
  const H = 300
  const margin = 8
  const x = Math.max(margin, Math.min(pos.x, viewportW - W - margin))
  const y = Math.max(margin, Math.min(pos.y, viewportH - H - margin))
  return { x, y }
}

export const useEpisodeStickyStore = create<EpisodeStickyState>((set, get) => ({
  open: false,
  position: DEFAULT_POSITION,
  selectedBookId: null,
  selectedKind: null,
  selectedSeason: 0,
  selectedEpisode: 0,
  hydrated: false,

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),

  setPosition: (pos) => {
    // clamp 后再写 localStorage,避免持久化越界值
    const clamped = typeof window !== 'undefined'
      ? clampPosition(pos, window.innerWidth, window.innerHeight)
      : pos
    set({ position: clamped })
    writeLS(POSITION_LS_KEY, clamped)
  },

  selectBook: (id, kind) => {
    const season = kind === 'episode' ? 1 : 0
    const episode = kind === 'episode' ? 1 : 0
    const next: StickySelection = { bookId: id, kind, season, episode }
    set({
      selectedBookId: id,
      selectedKind: kind,
      selectedSeason: season,
      selectedEpisode: episode
    })
    writeLS(SELECTION_LS_KEY, next)
  },

  selectEpisode: (season, episode) => {
    const { selectedKind } = get()
    if (selectedKind === 'movie') return // movie 不允许选集
    set({ selectedSeason: season, selectedEpisode: episode })
    const { selectedBookId } = get()
    if (selectedBookId && selectedKind) {
      writeLS(SELECTION_LS_KEY, {
        bookId: selectedBookId,
        kind: selectedKind,
        season,
        episode
      })
    }
  },

  clearSelection: () => {
    set({
      selectedBookId: null,
      selectedKind: null,
      selectedSeason: 0,
      selectedEpisode: 0
    })
    try { localStorage.removeItem(SELECTION_LS_KEY) } catch { /* ignore */ }
  },

  hydrate: () => {
    if (get().hydrated) return
    const pos = readLS<unknown>(POSITION_LS_KEY)
    const sel = readLS<unknown>(SELECTION_LS_KEY)

    const patch: Partial<EpisodeStickyState> = { hydrated: true }

    if (isValidPosition(pos)) {
      // clamp 到 viewport(viewport 在 hydrate 时可能还不对 —— 浮窗首次 mount 时再 clamp)
      patch.position = typeof window !== 'undefined'
        ? clampPosition(pos, window.innerWidth, window.innerHeight)
        : pos
    } else if (pos === null) {
      // 首次启动:把 x=-1 替换为 viewport 右上角(viewport width - 360 - 80)
      if (typeof window !== 'undefined') {
        patch.position = {
          x: Math.max(8, window.innerWidth - 360 - 80),
          y: 80
        }
      }
    }

    if (isValidSelection(sel)) {
      patch.selectedBookId = sel.bookId
      patch.selectedKind = sel.kind
      patch.selectedSeason = sel.season
      patch.selectedEpisode = sel.episode
    }

    set(patch)
  }
}))