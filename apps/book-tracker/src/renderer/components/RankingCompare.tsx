import { useEffect, useMemo } from 'react'
import type { Book, PairwiseResult, SeasonInfo, WorkKind } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { expectedScore } from '@core'
import { deriveRanking, findCandidate, useRankingStore } from '../store/ranking'
import { authorLabelFor } from './BookDetail.labels'

interface RankingCompareProps {
  pool: Book[]
}

// 排名卡片是紧凑布局,标签用短形式（出版/开始/首播/上映 等),与详情页 / 表单
// 的长形式(出版年份/开始年份/首播年份/上映年份) 故意区分;就地复制一份
// 不共享 BookDetail.labels.ts 的 yearLabelFor(后者太长,塞不进 compact card)。
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
 * - 池子里的 rankId 都已展示过 → 显示「本轮已无新候选」（可点工具栏 × 重置）
 */
export function RankingCompare({ pool }: RankingCompareProps): JSX.Element {
  const kind = useRankingStore((s) => s.kind)
  const file = useRankingStore((s) => s.file)
  const currentPair = useRankingStore((s) => s.currentPair)
  const sessionCount = useRankingStore((s) => s.sessionCount)
  const recentlyShown = useRankingStore((s) => s.recentlyShown)
  const pickPair = useRankingStore((s) => s.pickPair)
  const applyResult = useRankingStore((s) => s.applyResult)

  // 进入时如果还没有 pair 就拉一对
  useEffect(() => {
    if (!currentPair && kind) {
      pickPair(pool)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // v1.2:tv/anime 按季拆分后,池大小用 RankCandidate 数(展开后)。
  // 这里先 derive 一次,拿到 candidates + poolIds;不直接调 expandRankingPool 是为了避免重复扫。
  // v1.7(避免 hook 顺序漂移):把 deriveRanking 包进 useMemo,并上移到所有 early return 之前,
  // kind=null 时它返回空 candidates/poolIds,后续判断 (kind/池大小/freshCount) 都能正确 fallthrough。
  const derived = useMemo(
    () => deriveRanking(file, pool, kind),
    [file, pool, kind]
  )
  const expandedPoolIds = derived.poolIds

  // v1.7:『已展示过』的 rankId 集合(本会话内已跳过/选过的)。
  // 这一组不出现在下一对里,避免"跳过只换一个老熟人"的体验。
  const shownSet = useMemo(() => new Set(recentlyShown), [recentlyShown])
  const freshCount = useMemo(
    () => expandedPoolIds.filter((id) => !shownSet.has(id)).length,
    [expandedPoolIds, shownSet]
  )

  if (!kind) {
    return <div className="ranking-empty">请先选择一种作品类型</div>
  }

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
    // pickPair 已选但没有新鲜候选(本会话内该 kind 全部都展示了)
    if (freshCount < 2) {
      return (
        <div className="ranking-empty">
          本轮对比的候选已经全部展示过。<br />
          关闭并重新打开 Modal、或点工具栏的{' '}
          <span style={{ fontFamily: 'monospace' }}>×</span>{' '}
          清屏按钮，可重置本轮。
        </div>
      )
    }
    // pickPair 还在执行(useEffect 触发后同帧设 state,理论上一帧后消失)
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

  // v1.7:没有"未展示过"的候选时,跳过按钮禁用 + 提示,避免点了又落空
  const canSkip = freshCount >= 2

  return (
    <div className="ranking-compare">
      <div className="ranking-compare-meta">
        {WORK_KIND_LABELS[kind]} · 池 {expandedPoolIds.length} 个（未展示{' '}
        <b>{freshCount}</b> / 已展示 {expandedPoolIds.length - freshCount}）· 本次已对比{' '}
        {sessionCount} 次
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
        <button
          className="ranking-compare-skip"
          onClick={() => pickPair(pool)}
          disabled={!canSkip}
          title={
            canSkip
              ? '换一对（本次会话内已展示过的不再出现）'
              : '本会话内已展示过所有候选，点工具栏 × 重置'
          }
        >
          跳过这对
        </button>
        <button className="ranking-compare-tie" onClick={() => applyResult(pool, 'tie')}>
          平局
        </button>
      </div>
      <div className="ranking-compare-hint">
        点击左侧 / 右侧表示更喜欢该作品；「跳过」换一对未展示过的；「平局」让双方分数互相靠拢。
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
 * 信息层级：类型 + 池内排名 / 标题 / 字段表（主创·年份·地区·译者·主演·看过次数·收录时间）/
 * 笔记摘录 / 标签 / 评分脚注（评分 + 预期胜率 + 交手战绩）。
 * 内容溢出时卡片内部滚动，不撑破正方形比例。
 *
 * v1.2:tv/anime 候选可按季拆分(candidate.season 非空),编号里带 `#${season.number}` 区分;
 * v2.x:S0X 徽标移除(v1.6 起每本书追踪一季,S 语义冗余),编号仍保留以区分多季书的 ranking。
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
