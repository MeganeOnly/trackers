import { useState } from 'react'
import { Modal } from './Modal'
import { useGoalsStore } from '../store/goals'
import type { Goal, GoalStatus } from '@shared/types'

interface GoalFormProps {
  /** null = 加目标；非空 = 编辑目标 */
  goal: Goal | null
  onClose: () => void
}

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'not_started', label: '未开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'done', label: '已达成' },
  { value: 'shelved', label: '搁置' },
  { value: 'abandoned', label: '放弃' }
]

export function GoalForm({ goal, onClose }: GoalFormProps): JSX.Element {
  const create = useGoalsStore((s) => s.create)
  const update = useGoalsStore((s) => s.update)
  const remove = useGoalsStore((s) => s.remove)

  const isEdit = goal !== null

  const [title, setTitle] = useState(goal?.title ?? '')
  const [category, setCategory] = useState(goal?.category ?? '')
  const [deadline, setDeadline] = useState<string>(goal?.deadline ?? '')
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'not_started')
  // 量化进度（仅 status === 'in_progress' 时提交到 input）
  const [progressCurrent, setProgressCurrent] = useState<string>(
    goal?.progress?.current !== undefined ? String(goal.progress.current) : ''
  )
  const [progressTotal, setProgressTotal] = useState<string>(
    goal?.progress?.total !== undefined && goal.progress.total !== null
      ? String(goal.progress.total)
      : ''
  )
  const [note, setNote] = useState(goal?.note ?? '')
  const [pinned, setPinned] = useState(goal?.pinned ?? false)
  const [hidden, setHidden] = useState(goal?.hidden ?? false)
  const [collapsed, setCollapsed] = useState(goal?.collapsed ?? false)
  const [countable, setCountable] = useState(goal?.countable ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!title.trim()) {
      setError('目标名称不能为空')
      return
    }
    const d = deadline.trim()
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setError('截止日期格式应为 YYYY-MM-DD，如 2025-06-30')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Parameters<typeof create>[0] = {
        title: title.trim(),
        category: category.trim(),
        deadline: d,
        status,
        progress: null,
        note: note.trim(),
        countable,
        pinned,
        hidden,
        collapsed
      }
      // countable 任务：progress 与 status 解耦
      if (countable) {
        const c = Number(progressCurrent)
        if (progressCurrent.trim() !== '' && Number.isFinite(c) && c >= 0) {
          const tRaw = progressTotal.trim()
          const t = tRaw === '' ? null : Number(tRaw)
          input.progress = {
            current: Math.floor(c),
            total: t !== null && Number.isFinite(t) && t > 0 ? Math.floor(t) : null
          }
        }
      } else if (status === 'in_progress') {
        // 非 countable 沿用旧行为
        const c = Number(progressCurrent)
        if (progressCurrent.trim() !== '' && Number.isFinite(c) && c >= 0) {
          const tRaw = progressTotal.trim()
          const t = tRaw === '' ? null : Number(tRaw)
          input.progress = {
            current: Math.floor(c),
            total: t !== null && Number.isFinite(t) && t > 0 ? Math.floor(t) : null
          }
        }
      }
      if (isEdit && goal) {
        const patch: Parameters<typeof update>[1] = input
        // 非 countable 且非 in_progress：清空 progress（用户主动清除意图）
        if (!countable && status !== 'in_progress') patch.progress = null
        await update(goal.id, patch)
      } else {
        await create(input)
      }
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!goal) return
    if (!confirm(`删除《${goal.title}》？关联关系也会失效（relations.json 不会自动清理）。`)) return
    setBusy(true)
    try {
      await remove(goal.id)
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `编辑《${goal.title}》` : '加目标'}
      onClose={onClose}
      width={600}
      backdropClassName="modal-backdrop--top"
      footer={
        <div className="form-footer">
          {isEdit && (
            <button type="button" className="btn-danger" onClick={handleDelete} disabled={busy}>
              删除
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" form="goal-form" className="btn-primary" disabled={busy}>
            {busy ? '保存中...' : '保存'}
          </button>
        </div>
      }
    >
      <form id="goal-form" onSubmit={handleSubmit} className="goal-form">
        <label className="field">
          <span>目标名称 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="如：国奖 / 三好 / 两篇 SCI" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>分类</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如：学业 / 科研 / 健康" />
          </label>
          <label className="field">
            <span>截止日期</span>
            <input
              type="text"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="留空 = 无截止（格式：2025-06-30）"
            />
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
        {(status === 'in_progress' || countable) && (
          <div className="field-row progress-fields">
            <label className="field">
              <span>{countable ? '当前完成次数' : '当前进度'}</span>
              <input
                type="number"
                value={progressCurrent}
                onChange={(e) => setProgressCurrent(e.target.value)}
                min="0"
                placeholder={countable ? '如 5（不填 = 0）' : '如 1'}
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
            <span title="日常模式顶部『进行中』栏置顶展示（仅 in_progress 生效）">置顶进行中</span>
          </label>
        )}
        {(status === 'not_started' || status === 'in_progress') && (
          <label className="form-checkline">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            <span title="从 CleanMode『现在能推进』列表隐藏（仅 not_started / in_progress 生效，不影响解锁）">日常模式隐藏</span>
          </label>
        )}
        <label className="form-checkline">
          <input
            type="checkbox"
            checked={collapsed}
            onChange={(e) => setCollapsed(e.target.checked)}
          />
          <span>在编辑模式侧栏中收起（移到『已收起』分组，不影响 status 与解锁）</span>
        </label>
        <label className="form-checkline">
          <input
            type="checkbox"
            checked={countable}
            onChange={(e) => setCountable(e.target.checked)}
          />
          <span title="可计数任务 —— 别的目标引用时可指定需要完成多少次（完成次数与 status 解耦）">可计数</span>
        </label>
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
      </form>
    </Modal>
  )
}
