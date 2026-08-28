import { useEffect } from 'react'
import type { Book } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { useRankingStore } from '../store/ranking'

interface RankingCompareProps {
  pool: Book[]
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

  if (poolIds.length < 2) {
    return (
      <div className="ranking-empty">
        当前类型需要至少 2 个已读作品才能排名。
        <br />
        已有 <b>{poolIds.length}</b> 个，还差 <b>{2 - poolIds.length}</b> 个。
      </div>
    )
  }

  if (!currentPair) {
    // pickPair 异步选了之后会被 effect 设置；这里给个过渡态
    return <div className="ranking-empty">正在选下一对…</div>
  }

  const [aId, bId] = currentPair
  const bookMap = new Map(pool.map((b) => [b.id, b]))
  const bookA = bookMap.get(aId)
  const bookB = bookMap.get(bId)

  if (!bookA || !bookB) {
    return <div className="ranking-empty">候选作品不存在，请跳过</div>
  }

  return (
    <div className="ranking-compare">
      <div className="ranking-compare-meta">
        {WORK_KIND_LABELS[kind]} · 池 {poolIds.length} 本 · 本次已对比 {sessionCount} 次
      </div>
      <div className="ranking-compare-stage">
        <CompareCard book={bookA} onPick={() => applyResult(pool, 'a')} side="left" />
        <div className="ranking-compare-vs">VS</div>
        <CompareCard book={bookB} onPick={() => applyResult(pool, 'b')} side="right" />
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

interface CompareCardProps {
  book: Book
  onPick: () => void
  side: 'left' | 'right'
}

function CompareCard({ book, onPick, side }: CompareCardProps): JSX.Element {
  return (
    <button
      className={`ranking-compare-card ranking-compare-card--${side}`}
      onClick={onPick}
      type="button"
    >
      <div className="ranking-compare-card-title">{book.title || '（无标题）'}</div>
      <div className="ranking-compare-card-meta">
        {book.author && <span>{book.author}</span>}
        {book.year > 0 && <span> · {book.year}</span>}
        {book.country && <span> · {book.country}</span>}
      </div>
      {book.tags.length > 0 && (
        <div className="ranking-compare-card-tags">
          {book.tags.map((t) => (
            <span key={t} className="ranking-compare-card-tag">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="ranking-compare-card-pick">选 {side === 'left' ? '←' : '→'}</div>
    </button>
  )
}
