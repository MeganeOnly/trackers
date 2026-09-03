import { create } from 'zustand'
import {
  countComparisons,
  defaultRankingFile,
  pickNextPair,
  recomputeRatings
} from '@core'
import type { Book, PairwiseResult, RankingFile, SeasonInfo, WorkKind } from '@shared/types'
import { api } from '../lib/api'

/**
 * 排名 store —— 两两对比排名的状态机。
 *
 * 数据流：
 * 1. 启动时 `load()` 从后端拉 RankingFile（仅 history + 参数）
 * 2. 选择 kind 后，从前端 books 池（finished + 同 kind）派生「当前评分池」
 * 3. UI 通过 `pickPair()` 拿下一对；选完调 `applyResult()` 写回
 *
 * **v1.2 改动**：tv / anime 按季拆分（rank ID = `${bookId}#${seasonNumber}`），
 * 让不同季之间可独立排名（解决"前后季质量差异大不能放一起比"问题）。
 * 其他 kind（book / movie / other）保持 rank ID = book.id 不变。
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
 * 排名池里的一项 —— rankId 是 PairwiseResult 的 a/b 字段用的 ID:
 * - 非 tv/anime:`rankId === book.id`
 * - tv/anime:`rankId === "${book.id}#${seasonNumber}"`
 */
export interface RankCandidate {
  rankId: string
  book: Book
  /** undefined = 非 tv/anime(整本书当候选);number = 候选是该书的第几季 */
  season?: SeasonInfo
}

/**
 * 把已 finished 的 books 按 kind 展开成 rank 候选。
 * tv/anime 按季拆;其他 kind 一本书一项。
 * 无 seasons 字段的 tv/anime 兜底为单季(`${id}#1`),保留可排名语义。
 */
export function expandRankingPool(books: ReadonlyArray<Book>, kind: WorkKind): RankCandidate[] {
  const finished = books.filter((b) => b.status === 'finished' && b.kind === kind)
  const out: RankCandidate[] = []
  for (const b of finished) {
    if (kind === 'tv' || kind === 'anime') {
      const seasons = b.seasons && b.seasons.length > 0 ? b.seasons : null
      if (seasons) {
        for (const s of seasons) {
          out.push({ rankId: `${b.id}#${s.number}`, book: b, season: s })
        }
      } else {
        // 单季剧兜底
        out.push({ rankId: `${b.id}#1`, book: b })
      }
    } else {
      out.push({ rankId: b.id, book: b })
    }
  }
  return out
}

/** 从 rankId 解析出 (bookId, seasonNumber?)。解析失败 → null。 */
export function parseRankId(rankId: string): { bookId: string; season?: number } | null {
  const hashIdx = rankId.indexOf('#')
  if (hashIdx < 0) {
    if (!rankId) return null
    return { bookId: rankId }
  }
  const bookId = rankId.slice(0, hashIdx)
  const seasonStr = rankId.slice(hashIdx + 1)
  const season = Number(seasonStr)
  if (!bookId || !Number.isInteger(season) || season < 1) return null
  return { bookId, season }
}

/** 给定 rankId + 已展开的 pool,找到对应候选。 */
export function findCandidate(
  candidates: ReadonlyArray<RankCandidate>,
  rankId: string
): RankCandidate | undefined {
  return candidates.find((c) => c.rankId === rankId)
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
    const candidates = expandRankingPool(pool, kind)
    const poolIds = candidates.map((c) => c.rankId)
    const ratings = recomputeRatings(file.history, poolIds, file.initialRating, file.kFactor)
    const pair = pickNextPair(poolIds, file.history, ratings, file.initialRating)
    set({ currentPair: pair })
  },

  applyResult: async (pool, winner) => {
    const { currentPair } = get()
    if (!currentPair) return
    const [a, b] = currentPair
    // ts 由后端用 `frontmatter::now_iso()` 覆盖（PairwiseResult.ts 字段为 `#[serde(default)]`），
    // 前端无需也不应该传 ts。早期版本在这里构造了 `entry` 但没真正发出去，导致
    // 实际入参 `{ a, b, winner }` 缺 ts 触发 IPC 反序列化失败、catch 静默吞掉——
    // 表现为「点了左右卡片没反应、currentPair 不变」。
    try {
      const newFile = await api.ranking.apply({ a, b, winner })
      set((s) => ({
        file: sanitizeFile(newFile),
        sessionCount: s.sessionCount + 1
      }))
      // 立即选下一对（用刚刚拿到的最新 file + 同 pool）
      const { kind } = get()
      if (kind) {
        const candidates = expandRankingPool(pool, kind)
        const poolIds = candidates.map((c) => c.rankId)
        const cur = get().file
        const ratings = recomputeRatings(cur.history, poolIds, cur.initialRating, cur.kFactor)
        const nextPair = pickNextPair(poolIds, cur.history, ratings, cur.initialRating)
        set({ currentPair: nextPair })
      }
    } catch (e) {
      console.error('ranking apply failed:', e)
    }
  },

  resetSession: () => set({ sessionCount: 0 })
}))

/* ---------------- 派生 helper（纯函数，组件内调用） ---------------- */

/**
 * 从 RankingFile + 当前 kind 池派生「已过滤的 history」+「当前评分」+「每本对比次数」+「候选」。
 * 集中放在文件底部是为了让 store action 保持瘦；UI 通过这个 helper 拿到派生数据。
 *
 * 返回的 candidates 用于 UI 层把 rankId 反查回 Book + 季信息。
 */
export function deriveRanking(
  file: RankingFile,
  pool: ReadonlyArray<Book>,
  kind: WorkKind | null
): {
  history: PairwiseResult[]
  ratings: Record<string, number>
  counts: Record<string, number>
  poolIds: string[]
  candidates: RankCandidate[]
} {
  const candidates = kind ? expandRankingPool(pool, kind) : []
  const poolIds = candidates.map((c) => c.rankId)
  const ratings = recomputeRatings(file.history, poolIds, file.initialRating, file.kFactor)
  const counts = countComparisons(file.history, poolIds)
  // 只保留 a/b 都在池内的条目
  const poolSet = new Set(poolIds)
  const history = file.history.filter((e) => poolSet.has(e.a) && poolSet.has(e.b))
  return { history, ratings, counts, poolIds, candidates }
}
