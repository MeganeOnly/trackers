import { useEffect } from 'react'
import type { Book, PairwiseResult, SeasonInfo, WorkKind } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { expectedScore } from '@core'
import { deriveRanking, findCandidate, useRankingStore } from '../store/ranking'

interface RankingCompareProps {
  pool: Book[]
}

// 类型相关字段标签 —— 与 BookDetail / BookForm 保持一致（就近复制，见 BookDetail 同段注释）
function authorLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'anime': return '原作 / 主创'
    case 'tv': return '原作 / 主创'
    case 'movie': return '导演'
    case 'other': return '作者 / 主创'
    case 'book': return '作者'
  }
}
function yearLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'book': return '出版'
    case 'anime': return '开始'
    case 'tv': return '首播'
    case 'movie': return '上映'
    case 'other': return '年份'
  }
}
function countryLabelFor(kind: WorkKind): string {
  return kind === 'book' ? '原产地' : '制片国'
}

/**
 * 两两对比视图 —— 同一时间展示两本候选，用户点击其中一本表示「更喜欢这个」。
 *
 * - 进入 view 时如果没有 currentPair，自动调 pickPair 选一对
 * - applyResult 后 store 会自动选下一对
 * - 池子 < 2 时显示空状态
 */
export function RankingCompare({ pool }: RankingCompareProps): JSX.Element {
  const kind = useRankingStore((s) => s.kind)
  const file = useRankingStore((s) => s.file)
  const currentPair = useRankingStore((s) => s.currentPair)
  const sessionCount = useRankingStore((s) => s.sessionCount)
  const pickPair = useRankingStore((s) => s.pickPair)
  const applyResult = useRankingStore((s) => s.applyResult)

  // 进入时如果还没有 pair 就拉一对
  useEffect(() => {
    if (!currentPair && kind) {
      pickPair(pool)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  if (!kind) {
    return <div className="ranking-empty">请先选择一种作品类型</div>
  }

  const poolIds = pool.filter((b) => b.status === 'finished' && b.kind === kind).map((b) => b.id)

  // v1.2:tv/anime 按季拆分后,池大小用 RankCandidate 数(展开后)
  // 这里先 derive 一次,拿到 candidates + poolIds;不直接调 expandRankingPool 是为了避免重复扫
  const derived = deriveRanking(file, pool, kind)
  const expandedPoolIds = derived.poolIds

  if (expandedPoolIds.length < 2) {
    return (
      <div className="ranking-empty">
        当前类型需要至少 2 个已读作品才能排名。
        <br />
        已有 <b>{expandedPoolIds.length}</b> 个，还差 <b>{2 - expandedPoolIds.length}</b> 个。
      </div>
    )
  }

  if (!currentPair) {
    // pickPair 异步选了之后会被 effect 设置；这里给个过渡态
    return <div className="ranking-empty">正在选下一对…</div>
  }

  const [aId, bId] = currentPair
  const candA = findCandidate(derived.candidates, aId)
  const candB = findCandidate(derived.candidates, bId)

  if (!candA || !candB) {
    return <div className="ranking-empty">候选作品不存在，请跳过</div>
  }

  // 当前评分 / 对比次数 / 池内排名：卡片上直接展示，让"这一对的实力位置"一目了然
  const { ratings, counts, history } = derived
  const baseRating = Number.isFinite(file.initialRating) ? file.initialRating : 1500
  const scoreOf = (id: string): number => (Number.isFinite(ratings[id]) ? ratings[id] : baseRating)
  const byScore = [...expandedPoolIds].sort((x, y) => scoreOf(y) - scoreOf(x))
  const rankOf = (id: string): number => byScore.indexOf(id) + 1

  // 两者的历史交手战绩（谁赢过谁几次）—— 让用户知道"这一对是不是老对手"
  const h2h = headToHead(history, aId, bId)
  // Elo 预期胜率：分差换算成"按历史表现，这一方获胜的概率"
  const winRateA = expectedScore(scoreOf(aId), scoreOf(bId))

  return (
    <div className="ranking-compare">
      <div className="ranking-compare-meta">
        {WORK_KIND_LABELS[kind]} · 池 {expandedPoolIds.length} 个 · 本次已对比 {sessionCount} 次
        {h2h.total > 0 && (
          <>
            {' '}
            · 这两者交手 {h2h.total} 次（{h2h.aWins}–{h2h.bWins}
            {h2h.ties > 0 ? `，平 ${h2h.ties}` : ''}）
          </>
        )}
      </div>
      <div className="ranking-compare-stage">
        <CompareCard
          candidate={candA}
          onPick={() => applyResult(pool, 'a')}
          side="left"
          score={scoreOf(aId)}
          count={counts[aId] ?? 0}
          rank={rankOf(aId)}
          total={expandedPoolIds.length}
          winRate={winRateA}
          wins={h2h.aWins}
          losses={h2h.bWins}
          ties={h2h.ties}
        />
        <div className="ranking-compare-vs">VS</div>
        <CompareCard
          candidate={candB}
          onPick={() => applyResult(pool, 'b')}
          side="right"
          score={scoreOf(bId)}
          count={counts[bId] ?? 0}
          rank={rankOf(bId)}
          total={expandedPoolIds.length}
          winRate={1 - winRateA}
          wins={h2h.bWins}
          losses={h2h.aWins}
          ties={h2h.ties}
        />
      </div>
      <div className="ranking-compare-actions">
        <button className="ranking-compare-skip" onClick={() => pickPair(pool)}>
          跳过这对
        </button>
        <button className="ranking-compare-tie" onClick={() => applyResult(pool, 'tie')}>
          平局
        </button>
      </div>
      <div className="ranking-compare-hint">
        点击左侧 / 右侧表示更喜欢该作品；「跳过」不计入历史；「平局」让双方分数互相靠拢。
      </div>
    </div>
  )
}

/** 统计 x / y 两者的历史交手战绩（顺序无关，history 里 a/b 位置可能互换）。 */
function headToHead(
  history: readonly PairwiseResult[],
  x: string,
  y: string
): { total: number; aWins: number; bWins: number; ties: number } {
  let aWins = 0
  let bWins = 0
  let ties = 0
  for (const e of history) {
    const forward = e.a === x && e.b === y
    const backward = e.a === y && e.b === x
    if (!forward && !backward) continue
    if (e.winner === 'tie') ties += 1
    else if ((forward && e.winner === 'a') || (backward && e.winner === 'b')) aWins += 1
    else bWins += 1
  }
  return { total: aWins + bWins + ties, aWins, bWins, ties }
}

/** ISO 时间戳 → `YYYY-MM-DD`（无效值返回空串，不抛错）。 */
function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

interface CompareCardProps {
  candidate: import('../store/ranking').RankCandidate
  onPick: () => void
  side: 'left' | 'right'
  /** 当前 Elo 评分 */
  score: number
  /** 已对比次数 */
  count: number
  /** 当前池内排名（1 = 第一） */
  rank: number
  /** 池容量（用于「3 / 12」展示） */
  total: number
  /** Elo 预期胜率（0–1），对手为本对的另一方 */
  winRate: number
  /** 与本对对手的历史交手：胜 / 负 / 平 */
  wins: number
  losses: number
  ties: number
}

/**
 * 单张候选卡片（正方形，`aspect-ratio: 1`）。
 *
 * 信息层级：类型 + 季徽标(tv/anime) + 池内排名 / 标题 / 字段表（主创·年份·地区·译者·主演·看过次数·收录时间）/
 * 笔记摘录 / 标签 / 评分脚注（评分 + 预期胜率 + 交手战绩）。
 * 内容溢出时卡片内部滚动，不撑破正方形比例。
 *
 * v1.2:tv/anime 候选是按季拆分的,candidate.season 非空时标题右侧显示「S0X」徽标。
 */
function CompareCard({
  candidate,
  onPick,
  side,
  score,
  count,
  rank,
  total,
  winRate,
  wins,
  losses,
  ties
}: CompareCardProps): JSX.Element {
  const book = candidate.book
  const season = candidate.season
  const kind = book.kind
  const rows: Array<[string, string]> = []
  if (book.author) rows.push([authorLabelFor(kind), book.author])
  if (book.year > 0) rows.push([yearLabelFor(kind), String(book.year)])
  if (book.country) rows.push([countryLabelFor(kind), book.country])
  if (kind === 'book' && book.translator) rows.push(['译者', book.translator])
  if ((kind === 'movie' || kind === 'tv') && book.starring) rows.push(['主演', book.starring])
  if ((kind === 'movie' || kind === 'tv') && book.screenwriter) rows.push(['编剧', book.screenwriter])
  if (season) rows.push(['季', `S${String(season.number).padStart(2, '0')} · ${season.episodeCount} 集`])
  rows.push(['看过', book.read_count > 1 ? `${book.read_count} 次` : '1 次'])
  const finishedAt = shortDate(book.updated)
  if (finishedAt) rows.push(['最近更新', finishedAt])
  const addedAt = shortDate(book.created)
  if (addedAt) rows.push(['收录于', addedAt])
  rows.push(['编号', `#${book.id}${season ? `#${season.number}` : ''}`])

  const h2hText =
    wins + losses + ties === 0
      ? '首次交手'
      : `交手 ${wins} 胜 ${losses} 负${ties > 0 ? ` ${ties} 平` : ''}`

  return (
    <button
      className={`ranking-compare-card ranking-compare-card--${side}`}
      onClick={onPick}
      type="button"
    >
      <div className="ranking-compare-card-top">
        <span className="ranking-compare-card-kind">{WORK_KIND_LABELS[kind]}</span>
        {season && (
          <span className="ranking-compare-card-season">
            S{String(season.number).padStart(2, '0')}
          </span>
        )}
        <span className="ranking-compare-card-rank">
          当前第 {rank} / {total}
        </span>
      </div>

      <div className="ranking-compare-card-title">{book.title || '（无标题）'}</div>

      <dl className="ranking-compare-card-rows">
        {rows.map(([label, value]) => (
          <div className="ranking-compare-card-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {book.notes && <div className="ranking-compare-card-notes">{book.notes}</div>}

      {book.tags.length > 0 && (
        <div className="ranking-compare-card-tags">
          {book.tags.map((t) => (
            <span key={t} className="ranking-compare-card-tag">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="ranking-compare-card-foot">
        <span className="ranking-compare-card-score">{score.toFixed(0)}</span>
        <span className="ranking-compare-card-footmeta">
          预期胜率 {(winRate * 100).toFixed(0)}% · 已对比 {count} 次
          <br />
          {h2hText}
        </span>
      </div>
    </button>
  )
}
