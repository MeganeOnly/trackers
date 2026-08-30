import { create } from 'zustand'
import {
  countComparisons,
  defaultRankingFile,
  pickNextPair,
  recomputeRatings
} from '@core'
import type { Book, PairwiseResult, RankingFile, WorkKind } from '@shared/types'
import { api } from '../lib/api'

/**
 * 排名 store —— 两两对比排名的状态机。
 *
 * 数据流：
 * 1. 启动时 `load()` 从后端拉 RankingFile（仅 history + 参数）
 * 2. 选择 kind 后，从前端 books 池（finished + 同 kind）派生「当前评分池」
 * 3. UI 通过 `pickPair()` 拿下一对；选完调 `applyResult()` 写回
 *
 * 评分完全由 history + 当前池派生（recomputeRatings），不在 store 里持久化。
 */

interface RankingState {
  /** 后端原始 RankingFile；UI 用 `currentFile()` 派生视图 */
  file: RankingFile
  /** 当前选中的 kind；切换会清空 currentPair，触发重新选 pair */
  kind: WorkKind | null
  /** 当前展示的下一对（null = 池子不够或用户没开始对比） */
  currentPair: [string, string] | null
  /** 本次会话累计对比次数（前端计数，方便 UI 显示「本次 +N」） */
  sessionCount: number
  /** loading / error 标记 */
  loading: boolean

  load: () => Promise<void>
  setKind: (kind: WorkKind | null) => void
  pickPair: (pool: Book[]) => void
  applyResult: (pool: Book[], winner: 'a' | 'b' | 'tie') => Promise<void>
  /** 重置本次会话计数（不抹 history） */
  resetSession: () => void
}

/**
 * 后端返回值净化 —— 缺字段 / 字段错位（如键名不是 camelCase）时兜底成默认值。
 * 缺了这层，`initialRating` 会是 undefined，评分全线变成 undefined/NaN，
 * 渲染 `score.toFixed()` 直接抛 TypeError 把整个 App 崩成白屏。
 */
function sanitizeFile(file: RankingFile): RankingFile {
  const d = defaultRankingFile()
  return {
    version: Number.isFinite(file?.version) ? file.version : d.version,
    initialRating: Number.isFinite(file?.initialRating) ? file.initialRating : d.initialRating,
    kFactor: Number.isFinite(file?.kFactor) ? file.kFactor : d.kFactor,
    history: Array.isArray(file?.history) ? file.history : []
  }
}

export const useRankingStore = create<RankingState>((set, get) => ({
  file: defaultRankingFile(),
  kind: null,
  currentPair: null,
  sessionCount: 0,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const file = await api.ranking.get()
      set({ file: sanitizeFile(file), loading: false })
    } catch (e) {
      console.error('ranking load failed:', e)
      set({ loading: false })
    }
  },

  setKind: (kind) => {
    set({ kind, currentPair: null })
  },

  pickPair: (pool) => {
    const { file, kind } = get()
    if (!kind) {
      set({ currentPair: null })
      return
    }
    const poolIds = pool
      .filter((b) => b.status === 'finished' && b.kind === kind)
      .map((b) => b.id)
    const ratings = recomputeRatings(file.history, poolIds, file.initialRating, file.kFactor)
    const pair = pickNextPair(poolIds, file.history, ratings, file.initialRating)
    set({ currentPair: pair })
  },

  applyResult: async (pool, winner) => {
    const { currentPair, file } = get()
    if (!currentPair) return
    const [a, b] = currentPair
    const entry: PairwiseResult = { a, b, winner, ts: '' } // ts 由后端覆盖
    try {
      const newFile = await api.ranking.apply({ a, b, winner })
      set((s) => ({
        file: sanitizeFile(newFile),
        sessionCount: s.sessionCount + 1
      }))
      // 立即选下一对（用刚刚拿到的最新 file + 同 pool）
      const { kind } = get()
      if (kind) {
        const poolIds = pool
          .filter((bk) => bk.status === 'finished' && bk.kind === kind)
          .map((bk) => bk.id)
        const cur = get().file
        const ratings = recomputeRatings(cur.history, poolIds, cur.initialRating, cur.kFactor)
        const nextPair = pickNextPair(poolIds, cur.history, ratings, cur.initialRating)
        set({ currentPair: nextPair })
      }
    } catch (e) {
      console.error('ranking apply failed:', e)
    }
    // 抑制未使用警告
    void entry
    void file
  },

  resetSession: () => set({ sessionCount: 0 })
}))

/* ---------------- 派生 helper（纯函数，组件内调用） ---------------- */

/**
 * 从 RankingFile + 当前 kind 池派生「已过滤的 history」+「当前评分」+「每本对比次数」。
 * 集中放在文件底部是为了让 store action 保持瘦；UI 通过这个 helper 拿到派生数据。
 */
export function deriveRanking(
  file: RankingFile,
  pool: Book[],
  kind: WorkKind | null
): {
  history: PairwiseResult[]
  ratings: Record<string, number>
  counts: Record<string, number>
  poolIds: string[]
} {
  const poolIds = kind
    ? pool.filter((b) => b.status === 'finished' && b.kind === kind).map((b) => b.id)
    : []
  const ratings = recomputeRatings(file.history, poolIds, file.initialRating, file.kFactor)
  const counts = countComparisons(file.history, poolIds)
  // 只保留 a/b 都在池内的条目
  const poolSet = new Set(poolIds)
  const history = file.history.filter((e) => poolSet.has(e.a) && poolSet.has(e.b))
  return { history, ratings, counts, poolIds }
}
