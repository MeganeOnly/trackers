import { useGoalsStore } from '../store/goals'
import { GoalCard } from './GoalCard'

interface GoalCardContainerProps {
  /** GoalCard 内点"编辑"时调，打开全局 GoalForm */
  onEdit: () => void
  /** 关闭右侧详情（回到纯图），由 GraphModal 传入 select(null) */
  onClose?: () => void
}

/**
 * 关系图右侧的卡片容器：跟随全局 selectedId 自动渲染对应书的详情。
 * - 已选中 → 渲染 GoalCard
 * - 未选中 → 显示提示（让用户知道怎么用）
 */
export function GoalCardContainer({ onEdit, onClose }: GoalCardContainerProps): JSX.Element {
  const selectedId = useGoalsStore((s) => s.selectedId)
  const goalExists = useGoalsStore((s) => (selectedId ? s.goals.some((b) => b.id === selectedId) : false))

  if (!selectedId || !goalExists) {
    return (
      <div className="goal-card-empty muted">
        <p>← 点左侧图中的节点查看这本书的详情</p>
        <p className="hint">所有操作（状态切换 / 进度 / 前置 / 编辑）都在这里</p>
      </div>
    )
  }

  return <GoalCard goalId={selectedId} onEdit={onEdit} onClose={onClose} />
}