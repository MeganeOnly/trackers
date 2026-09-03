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
 * **v1.7 改动**：会话内每个 rankId 最多展示一次（不论是选 a/b/tie 还是「跳过」）——
 * 通过 `recentlyShown` 会话状态 + `pickNextPair` 的 `exclude` 参数实现。这样点「跳过」
 * 后下一对是真正的新一对,而不是"老对再换位置"或"只换一个老熟人"。关闭 Modal / 切
 * kind / 点会话清屏按钮时 `recentlyShown` 重置。
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
  /**
   * 本次会话内已经展示过的 rankId 列表（顺序无意义，仅用来排除）。
   * - 选完（a/b/tie）或点「跳过」后被展示过的 rankId 都进这里。
   * - 重新打开 Modal / 切 kind / `resetSession()` 会清空。
   * - 用数组而非 Set：zustand 用 Object.is 比对,数组引用替换即可触发订阅者更新。
   */
  recentlyShown: string[]
  /** loading / error 标记 */
  loading: boolean

  load: () => Promise<void>
  setKind: (kind: WorkKind | null) => void
  pickPair: (pool: Book[]) => void
  applyResult: (pool: Book[], winner: 'a' | 'b' | 'tie') => Promise<void>
  /** 重置本次会话计数 + 清除『已展示过』集合（不抹 history） */
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
  recentlyShown: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const file = await api.ranking.get()
      // 重新打开 Modal 时重置本会话状态：避免上次的『已展示过』污染新的轮次
      set({ file: sanitizeFile(file), loading: false, recentlyShown: [], currentPair: null })
    } catch (e) {
      console.error('ranking load failed:', e)
      set({ loading: false })
    }
  },

  setKind: (kind) => {
    // 切 kind 时候选集合完全不同,旧 recentlyShown 没意义,一并清掉
    set({ kind, currentPair: null, recentlyShown: [] })
  },

  pickPair: (pool) => {
    pickAndRememberPool(set, get, pool)
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
      pickAndRememberPool(set, get, pool)
    } catch (e) {
      console.error('ranking apply failed:', e)
    }
  },

  resetSession: () =>
    set({ sessionCount: 0, recentlyShown: [], currentPair: null })
}))

/**
 * 内部 helper：用当前 kind 派生 pool,从『已展示过』集合以外选下一对,并把新一对
 * 加入已展示集合。如果过滤后候选不足 2 个,currentPair = null(由 UI 渲染"已无新
 * 候选"空状态)。
 *
 * 注意：先选下一对再加进 recentlyShown —— exclude 用的是『选之前已展示过』的集合,
 * 否则新一对会被自己排除、永远拿不到合法 pair。
 */
function pickAndRememberPool(
  set: (
    partial:
      | Partial<RankingState>
      | ((state: RankingState) => Partial<RankingState>)
  ) => void,
  get: () => RankingState,
  pool: ReadonlyArray<Book>
): void {
  const { file, kind, recentlyShown } = get()
  if (!kind) {
    set({ currentPair: null })
    return
  }
  const candidates = expandRankingPool(pool, kind)
  const poolIds = candidates.map((c) => c.rankId)
  const excludeSet = new Set(recentlyShown)
  const ratings = recomputeRatings(
    file.history,
    poolIds,
    file.initialRating,
    file.kFactor
  )
  const pair = pickNextPair(
    poolIds,
    file.history,
    ratings,
    file.initialRating,
    Math.random,
    excludeSet
  )
  if (pair === null) {
    set({ currentPair: null })
    return
  }
  const merged = new Set(recentlyShown)
  merged.add(pair[0])
  merged.add(pair[1])
  set({
    currentPair: pair,
    recentlyShown: Array.from(merged)
  })
}

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
