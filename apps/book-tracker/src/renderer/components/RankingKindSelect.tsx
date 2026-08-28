import type { WorkKind } from '@shared/types'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'

interface RankingKindSelectProps {
  value: WorkKind | null
  onChange: (kind: WorkKind | null) => void
  /** 各 kind 下的 finished 数量（用于 disabled 灰显） */
  counts: Partial<Record<WorkKind, number>>
}

/**
 * kind 选择器 —— tab 式。
 *
 * 排他约束：池子 < 2 的 kind 仍然可选（用户能进去看空状态），
 * 但具体行为由父组件根据 pool 长度决定是否显示对比视图。
 */
export function RankingKindSelect({
  value,
  onChange,
  counts
}: RankingKindSelectProps): JSX.Element {
  return (
    <div className="ranking-kind-select" role="tablist" aria-label="作品类型">
      {WORK_KIND_ORDER.map((k) => {
        const active = value === k
        const n = counts[k] ?? 0
        return (
          <button
            key={k}
            role="tab"
            aria-selected={active}
            className={`ranking-kind-tab${active ? ' active' : ''}`}
            onClick={() => onChange(k)}
          >
            {WORK_KIND_LABELS[k]} <span className="ranking-kind-count">{n}</span>
          </button>
        )
      })}
    </div>
  )
}
