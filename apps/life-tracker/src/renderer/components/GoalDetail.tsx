import { useGoalsStore } from '../store/goals'
import { useUnlocked } from '../store/selectors'
import { PrereqEditor } from './PrereqEditor'
import { progressPercent } from '@core'
import { formatGoalProgress } from '@shared/progress'
import type { Goal, GoalStatus } from '@shared/types'

interface GoalDetailProps {
  onEdit: () => void
  /** 显式指定显示哪个目标；不传则用全局 selectedId */
  goalId?: string
}

const STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function GoalDetail({ onEdit, goalId }: GoalDetailProps): JSX.Element {
  const selectedId = useGoalsStore((s) => s.selectedId)
  const goals = useGoalsStore((s) => s.goals)
  const update = useGoalsStore((s) => s.update)
  const bumpProgress = useGoalsStore((s) => s.bumpProgress)
  const effectiveId = goalId ?? selectedId
  const goal = goals.find((b) => b.id === effectiveId)
  const { unlocked, cycles } = useUnlocked()

  if (!goal) {
    return (
      <div className="detail-empty">
        <p className="muted">从左侧选一个目标，或点右上角 + 加目标。</p>
      </div>
    )
  }

  const isUnlocked = unlocked.get(goal.id) ?? true
  const cycle = cycles.find((c) => c.includes(goal.id))
  const pct = progressPercent(goal.progress)
  const overdue = !!goal.deadline && goal.status !== 'done' && goal.deadline < todayStr()

  async function quickSetStatus(status: Goal['status']): Promise<void> {
    if (!goal) return
    await update(goal.id, { status })
  }

  async function handleBump(delta: number): Promise<void> {
    if (!goal) return
    await bumpProgress(goal.id, delta)
  }

  return (
    <article className="goal-detail">
      <header className="detail-header">
        <h2>{goal.title}</h2>
        <div className="meta-row">
          <span className={`status-pill status-${goal.status}`}>
            {STATUS_LABELS[goal.status]}
          </span>
          {!isUnlocked && !cycle && <span className="lock-pill">未解锁</span>}
          {cycle && <span className="lock-pill error">循环依赖</span>}
        </div>
        <div className="detail-actions">
          <button onClick={onEdit}>编辑</button>
          {goal.status !== 'in_progress' && goal.status !== 'done' && (
            <button className="btn-secondary" onClick={() => quickSetStatus('in_progress')}>
              开始推进
            </button>
          )}
          {goal.status !== 'done' && (
            <button className="btn-secondary" onClick={() => quickSetStatus('done')}>
              标记达成
            </button>
          )}
        </div>
      </header>

      {goal.status === 'in_progress' && (
        <section className="progress-card">
          <div className="progress-card-header">
            <span className="progress-label">量化进度</span>
            <span className="progress-text">{formatGoalProgress(goal.progress) || '尚未记录'}</span>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-actions">
            <button className="btn-secondary" onClick={() => handleBump(-1)} title="回退 1">
              -1
            </button>
            <button className="btn-secondary" onClick={() => handleBump(+1)} title="推进 1">
              +1
            </button>
            <button className="btn-secondary" onClick={() => handleBump(+5)} title="推进 5">
              +5
            </button>
            <button className="quick-finish" onClick={() => quickSetStatus('done')}>
              达成
            </button>
          </div>
        </section>
      )}

      {goal.status === 'in_progress' && (
        <label className="pinned-toggle">
          <input
            type="checkbox"
            checked={goal.pinned}
            onChange={(e) => void update(goal.id, { pinned: e.target.checked })}
          />
          <span>置顶到『进行中』栏（日常模式顶部展示）</span>
        </label>
      )}

      <dl className="detail-fields">
        <dt>分类</dt>
        <dd>{goal.category || '—'}</dd>
        <dt>截止</dt>
        <dd>
          {goal.deadline ? (
            <span className={overdue ? 'deadline-overdue' : undefined}>
              {goal.deadline}
              {overdue && '（已逾期）'}
            </span>
          ) : (
            '—'
          )}
        </dd>
        <dt>备注</dt>
        <dd>{goal.note || '—'}</dd>
        <dt>ID</dt>
        <dd>
          <code>{goal.id}</code>
        </dd>
      </dl>

      <PrereqEditor goalId={goal.id} />
    </article>
  )
}
