import type { Book, WorkKind } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { deriveRanking, useRankingStore } from '../store/ranking'

interface RankingListProps {
  pool: Book[]
  kind: WorkKind | null
}

/**
 * 排名列表视图 —— 按 Elo 评分倒序列出当前 kind 池里的所有作品。
 *
 * 显示：rank / 标题 / 作者 / 类型 / 评分 / 对比次数。
 */
export function RankingList({ pool, kind }: RankingListProps): JSX.Element {
  const file = useRankingStore((s) => s.file)

  if (!kind) {
    return <div className="ranking-empty">请先选择一种作品类型</div>
  }
  const { ratings, counts, poolIds } = deriveRanking(file, pool, kind)

  if (poolIds.length === 0) {
    return (
      <div className="ranking-empty">
        还没有 <b>{WORK_KIND_LABELS[kind]}</b> 类的已读作品。
        <br />
        标记为「已读」后会出现在这里。
      </div>
    )
  }

  // 按评分倒序；评分相同按对比次数升序（新条目优先）
  const sorted = [...poolIds].sort((x, y) => {
    const d = (ratings[y] ?? file.initialRating) - (ratings[x] ?? file.initialRating)
    if (Math.abs(d) > 1e-6) return d
    return (counts[x] ?? 0) - (counts[y] ?? 0)
  })

  const bookMap = new Map(pool.map((b) => [b.id, b]))
  const maxRating = Math.max(...sorted.map((id) => ratings[id] ?? file.initialRating))
  const minRating = Math.min(...sorted.map((id) => ratings[id] ?? file.initialRating))
  const range = Math.max(maxRating - minRating, 1)

  return (
    <div className="ranking-list">
      <div className="ranking-list-header">
        <span className="col-rank">#</span>
        <span className="col-title">作品</span>
        <span className="col-author">作者</span>
        <span className="col-count">对比</span>
        <span className="col-score">评分</span>
      </div>
      <div className="ranking-list-body">
        {sorted.map((id, idx) => {
          const b = bookMap.get(id)
          if (!b) return null
          const score = ratings[id] ?? file.initialRating
          const count = counts[id] ?? 0
          // 归一化到 0-1，画条形图
          const norm = (score - minRating) / range
          return (
            <div className="ranking-list-row" key={id}>
              <span className="col-rank">{idx + 1}</span>
              <span className="col-title">
                <span className="ranking-list-bar" style={{ width: `${norm * 100}%` }} />
                <span className="ranking-list-title-text">{b.title}</span>
              </span>
              <span className="col-author">{b.author || '—'}</span>
              <span className="col-count">{count}</span>
              <span className="col-score">{score.toFixed(0)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
