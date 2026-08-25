import { GoalDetail } from './GoalDetail'

interface GoalCardProps {
  /** 卡片显示的目标 ID（必传 —— 卡片不依赖全局 selectedId） */
  goalId: string
  /** 关闭右侧详情（回到纯图）；传了就渲染卡片右上角的 × */
  onClose?: () => void
}

/**
 * 关系图右侧的目标详情卡片。结构与 EditMode 右侧 GoalDetail 一致
 * （功能齐全：状态 / 进度 / 前置编辑 / 字段内联可编辑），
 * 不读写全局 selectedId，因此不会污染 EditMode 里的选中状态。
 */
export function GoalCard({ goalId, onClose }: GoalCardProps): JSX.Element {
  return (
    <section className="goal-card">
      {onClose && (
        <button
          className="goal-card-close"
          onClick={onClose}
          aria-label="关闭右侧详情"
          title="关闭右侧详情"
        >
          ×
        </button>
      )}
      <GoalDetail goalId={goalId} />
    </section>
  )
}
