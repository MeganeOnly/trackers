import { GoalDetail } from './GoalDetail'

interface GoalCardProps {
  /** 卡片显示的书 ID（必传 —— 卡片不依赖全局 selectedId） */
  goalId: string
  /** 打开 GoalForm 编辑此书 */
  onEdit: () => void
  /** 关闭右侧详情（回到纯图）；传了就渲染卡片右上角的 × */
  onClose?: () => void
}

/**
 * 关系图右侧的书详情卡片。结构与 EditMode 右侧 GoalDetail 一致
 * （功能齐全：状态切换 / 进度 / 前置编辑 / 编辑表单入口），
 * 不读写全局 selectedId，因此不会污染 EditMode 里的选中状态。
 */
export function GoalCard({ goalId, onEdit, onClose }: GoalCardProps): JSX.Element {
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
      <GoalDetail goalId={goalId} onEdit={onEdit} />
    </section>
  )
}