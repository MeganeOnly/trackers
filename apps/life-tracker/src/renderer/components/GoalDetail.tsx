import { useEffect, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useUnlocked } from '../store/selectors'
import { PrereqEditor } from './PrereqEditor'
import { progressPercent } from '@core'
import { formatGoalProgress } from '@shared/progress'
import type { Goal, GoalInput, GoalStatus } from '@shared/types'

interface GoalDetailProps {
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

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'not_started', label: '未开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'done', label: '已达成' },
  { value: 'shelved', label: '搁置' },
  { value: 'abandoned', label: '放弃' }
]

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * 编辑模式右侧的目标详情 = 内联可编辑表单：
 * - 所有字段直接可编辑，点「保存」统一写盘，不再需要额外的「编辑」弹窗
 * - 无量化条目（progress === null）时只显示完成/未完成，不显示量化进度条
 * - 前置依赖编辑器与进度快捷调整（-1/+1/+5/达成）保留在下方
 */
export function GoalDetail({ goalId }: GoalDetailProps): JSX.Element {
  const selectedId = useGoalsStore((s) => s.selectedId)
  const goals = useGoalsStore((s) => s.goals)
  const update = useGoalsStore((s) => s.update)
  const bumpProgress = useGoalsStore((s) => s.bumpProgress)
  const remove = useGoalsStore((s) => s.remove)
  const select = useGoalsStore((s) => s.select)
  const effectiveId = goalId ?? selectedId
  const goal = goals.find((b) => b.id === effectiveId)
  const { unlocked, cycles } = useUnlocked()

  const [title, setTitle] = useState(goal?.title ?? '')
  const [category, setCategory] = useState(goal?.category ?? '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'not_started')
  const [progressCurrent, setProgressCurrent] = useState<string>(
    goal?.progress?.current !== undefined ? String(goal.progress.current) : ''
  )
  const [progressTotal, setProgressTotal] = useState<string>(
    goal?.progress?.total !== undefined && goal.progress.total !== null ? String(goal.progress.total) : ''
  )
  const [note, setNote] = useState(goal?.note ?? '')
  const [pinned, setPinned] = useState(goal?.pinned ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 切换条目时重置草稿（未保存的输入随之丢弃，与旧「弹窗编辑」语义一致）
  useEffect(() => {
    setTitle(goal?.title ?? '')
    setCategory(goal?.category ?? '')
    setDeadline(goal?.deadline ?? '')
    setStatus(goal?.status ?? 'not_started')
    setProgressCurrent(goal?.progress?.current !== undefined ? String(goal.progress.current) : '')
    setProgressTotal(
      goal?.progress?.total !== undefined && goal.progress.total !== null ? String(goal.progress.total) : ''
    )
    setNote(goal?.note ?? '')
    setPinned(goal?.pinned ?? false)
    setError(null)
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal?.id])

  if (!goal) {
    return (
      <div className="detail-empty">
        <p className="muted">从左侧选一个目标，或点右上角 + 加目标。</p>
      </div>
    )
  }
  // 窄化别名：TS 的 narrowing 不会传播进下面的嵌套函数声明，统一用 g
  const g = goal

  const isUnlocked = unlocked.get(g.id) ?? true
  const cycle = cycles.find((c) => c.includes(g.id))
  const pct = progressPercent(g.progress)
  const overdue = !!deadline && status !== 'done' && deadline < todayStr()

  async function handleBump(delta: number): Promise<void> {
    const updated = await bumpProgress(g.id, delta)
    setProgressCurrent(updated.progress?.current !== undefined ? String(updated.progress.current) : '')
    setProgressTotal(
      updated.progress?.total !== undefined && updated.progress.total !== null ? String(updated.progress.total) : ''
    )
  }

  async function handleFinish(): Promise<void> {
    setStatus('done')
    await update(g.id, { status: 'done' })
  }

  async function handleSave(): Promise<void> {
    if (!title.trim()) {
      setError('目标名称不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const patch: Partial<GoalInput> = {
        title: title.trim(),
        category: category.trim(),
        deadline: deadline.trim(),
        status,
        progress: null,
        note: note.trim(),
        pinned
      }
      // 仅当 status === 'in_progress' 且填了 current 时才把 progress 写进 patch
      if (status === 'in_progress') {
        const c = Number(progressCurrent)
        if (progressCurrent.trim() !== '' && Number.isFinite(c) && c >= 0) {
          const tRaw = progressTotal.trim()
          const t = tRaw === '' ? null : Number(tRaw)
          patch.progress = {
            current: Math.floor(c),
            total: t !== null && Number.isFinite(t) && t > 0 ? Math.floor(t) : null
          }
        }
      }
      // status 不是 in_progress 时主动清空 progress（用户主动清除意图）
      if (status !== 'in_progress') patch.progress = null
      await update(g.id, patch)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!confirm(`删除《${g.title}》？关联关系也会失效（relations.json 不会自动清理）。`)) return
    setBusy(true)
    setError(null)
    try {
      await remove(g.id)
      select(null)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <article className="goal-detail">
      <header className="detail-header">
        <input
          className="detail-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="目标名称"
        />
        <div className="meta-row">
          <span className={`status-pill status-${status}`}>{STATUS_LABELS[status]}</span>
          {!isUnlocked && !cycle && <span className="lock-pill">未解锁</span>}
          {cycle && <span className="lock-pill error">循环依赖</span>}
        </div>
        <div className="detail-actions">
          <button className="btn-danger" onClick={handleDelete} disabled={busy}>
            删除
          </button>
          <div className="spacer" />
          <button className="btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? '保存中...' : saved ? '已保存' : '保存'}
          </button>
        </div>
      </header>

      {status === 'in_progress' && goal.progress !== null && (
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
            <button className="btn-secondary" onClick={() => void handleBump(-1)} title="回退 1">
              -1
            </button>
            <button className="btn-secondary" onClick={() => void handleBump(+1)} title="推进 1">
              +1
            </button>
            <button className="btn-secondary" onClick={() => void handleBump(+5)} title="推进 5">
              +5
            </button>
            <button className="quick-finish" onClick={() => void handleFinish()}>
              达成
            </button>
          </div>
        </section>
      )}

      <div className="detail-form">
        <div className="field-row">
          <label className="field">
            <span>分类</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="如：学业 / 科研 / 健康"
            />
          </label>
          <label className="field">
            <span>截止日期</span>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            {overdue && <span className="deadline-overdue">已逾期</span>}
          </label>
        </div>
        <label className="field">
          <span>状态</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {status === 'in_progress' && (
          <div className="field-row progress-fields">
            <label className="field">
              <span>当前进度</span>
              <input
                type="number"
                value={progressCurrent}
                onChange={(e) => setProgressCurrent(e.target.value)}
                min="0"
                placeholder="如 1"
              />
            </label>
            <label className="field">
              <span>目标总量（可留空）</span>
              <input
                type="number"
                value={progressTotal}
                onChange={(e) => setProgressTotal(e.target.value)}
                min="1"
                placeholder="如 2；空 = 不设总量"
              />
            </label>
          </div>
        )}
        {status === 'in_progress' && (
          <label className="form-checkline">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            <span>置顶到『进行中』栏（日常模式顶部展示）</span>
          </label>
        )}
        <label className="field">
          <span>备注 / 描述</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={6}
            placeholder="这个目标的具体要求、衡量标准…"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
      </div>

      <PrereqEditor goalId={goal.id} />
    </article>
  )
}
