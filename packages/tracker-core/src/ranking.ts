// tracker-core —— 两两对比排名（Elo 算法）
//
// 领域无关：book-tracker 用它给已读作品排名，未来其他 tracker（如目标成就）也可直接复用。
// 数据存储约定：只持久化 history（结果序列），评分每次从 history + 当前 pool 重算。
// 这样删书后已不存在的条目会自动从评分里消失，不需要额外清理。

/** 单次两两对比结果（持久化的最小单元）。 */
export interface PairwiseResult {
  /** 选手 A 的 id */
  a: string
  /** 选手 B 的 id */
  b: string
  /** 哪一方获胜 */
  winner: 'a' | 'b' | 'tie'
  /** ISO 8601 时间戳 */
  ts: string
}

/** 完整的 rankings 文件结构（与 rankings.json 1:1）。 */
export interface RankingFile {
  version: number
  /** 新条目进入评分池时的初始分数（默认 1500） */
  initialRating: number
  /** Elo K 因子（默认 32；条目越多、对比越频繁可以调小） */
  kFactor: number
  /** 持久化的对比历史；评分由它实时计算 */
  history: PairwiseResult[]
}

/** 构造一个默认的 RankingFile。 */
export function defaultRankingFile(): RankingFile {
  return {
    version: 1,
    initialRating: 1500,
    kFactor: 32,
    history: []
  }
}

/** Elo 标准预期得分公式：玩家 A 战胜 B 的概率。 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * 单步应用一次对比结果，更新双方分数。
 *
 * 平局（winner === 'tie'）按 0.5 / 0.5 双向收敛。
 * 越弱的选手战胜越强的对手，分数变化越大（K 因子封顶）。
 */
export function applyPairwiseResult(
  ratings: Record<string, number>,
  result: Pick<PairwiseResult, 'a' | 'b' | 'winner'>,
  initialRating: number,
  kFactor: number
): Record<string, number> {
  const ra = ratings[result.a] ?? initialRating
  const rb = ratings[result.b] ?? initialRating
  const ea = expectedScore(ra, rb)
  const eb = 1 - ea
  const sa = result.winner === 'a' ? 1 : result.winner === 'tie' ? 0.5 : 0
  const sb = 1 - sa
  return {
    ...ratings,
    [result.a]: ra + kFactor * (sa - ea),
    [result.b]: rb + kFactor * (sb - eb)
  }
}

/**
 * 从 history + 合法 id 池重算所有评分。
 *
 * - pool 决定哪些 id 参与评分；历史里出现但不在 pool 的 id 视为已删除/失格，跳过其条目
 * - pool 里的 id 全部初始化为 initialRating，再顺序应用历史
 * - 空 history → 每个 pool id 都是 initialRating
 */
export function recomputeRatings(
  history: readonly PairwiseResult[],
  pool: Iterable<string>,
  initialRating: number,
  kFactor: number
): Record<string, number> {
  const poolSet = new Set<string>()
  for (const id of pool) poolSet.add(id)

  let ratings: Record<string, number> = {}
  for (const id of poolSet) ratings[id] = initialRating

  for (const entry of history) {
    if (!poolSet.has(entry.a) || !poolSet.has(entry.b)) continue
    ratings = applyPairwiseResult(ratings, entry, initialRating, kFactor)
  }
  return ratings
}

/**
 * 统计每个 id 的对比次数（仅统计 a/b 都在 pool 内的条目）。
 */
export function countComparisons(
  history: readonly PairwiseResult[],
  pool: Iterable<string>
): Record<string, number> {
  const poolSet = new Set<string>()
  for (const id of pool) poolSet.add(id)

  const counts: Record<string, number> = {}
  for (const id of poolSet) counts[id] = 0
  for (const entry of history) {
    // 与 recomputeRatings 保持一致：a/b 任一不在 pool 则整条不算，
    // 否则被删条目会让剩下的 id 单独"赚"对比数，导致 pair 选择偏向它们。
    if (!poolSet.has(entry.a) || !poolSet.has(entry.b)) continue
    counts[entry.a] = (counts[entry.a] ?? 0) + 1
    counts[entry.b] = (counts[entry.b] ?? 0) + 1
  }
  return counts
}

/**
 * 选下一对要对比的 (A, B)。
 *
 * 策略（启发式，目标是「让所有人都被充分比过」+「边界精度优先」）：
 * 1. A = 对比次数最少的 pool 成员（同等次数随机打破平局）；
 * 2. B = 评分最接近 A 的 pool 成员（排除 A 自身）。
 *
 * 池子少于 2 个 → 返回 null（前端应展示「至少需要 2 个」空状态）。
 *
 * `exclude`（可选）：本会话内「已经展示过」的 rankId 集合。
 * - 用于"跳过"语义：跳过不应立即弹出同一对。v1.7 演化为"会话内每本最多展示
 *   一次"——前端在 store 里维护已展示集合,每次 pickNextPair 都过滤掉它们。
 * - 与原算法的关系:首先按 exclude 缩窄候选,再在缩窄后的候选里按「最少比较」
 *   选 A、按"评分最接近"选 B。这样:
 *   a) exclude 为空时退化为原算法（向后兼容,所有原测试不需改）;
 *   b) exclude 缩窄后候选 < 2 → 返回 null（前端展示"本轮已无新候选")。
 * - 计数仍按 pool 全集算（不是缩窄后),避免被排除项因为"小池子里看着少"
 *   反被优先选出。
 */
export function pickNextPair(
  pool: readonly string[],
  history: readonly PairwiseResult[],
  ratings: Record<string, number>,
  initialRating: number,
  rng: () => number = Math.random,
  exclude: ReadonlySet<string> = new Set()
): [string, string] | null {
  if (pool.length < 2) return null
  const candidates = exclude.size === 0 ? pool : pool.filter((id) => !exclude.has(id))
  if (candidates.length < 2) return null

  // minCount 在 pool 全集内算（被排除项也参与"公平"基数,避免它们在小池里反被优先）
  const counts = countComparisons(history, pool)
  const minCount = Math.min(...candidates.map((id) => counts[id] ?? 0))
  const aTied = candidates.filter((id) => (counts[id] ?? 0) === minCount)
  const a = aTied[Math.floor(rng() * aTied.length)]

  const ratingA = ratings[a] ?? initialRating
  let bestB: string | null = null
  let bestDiff = Infinity
  for (const id of candidates) {
    if (id === a) continue
    const diff = Math.abs((ratings[id] ?? initialRating) - ratingA)
    if (diff < bestDiff) {
      bestDiff = diff
      bestB = id
    }
  }
  if (bestB === null) return null
  return [a, bestB]
}
