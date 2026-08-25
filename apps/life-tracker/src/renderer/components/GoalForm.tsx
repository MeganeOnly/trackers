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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!title.trim()) {
      setError('目标名称不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Parameters<typeof create>[0] = {
        title: title.trim(),
        category: category.trim(),
        deadline: deadline.trim(),
        status,
        progress: null,
        note: note.trim()
      }
      // 仅当 status === 'in_progress' 且填了 current 时才把 progress 写进 input
      if (status === 'in_progress') {
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
        // 编辑模式下，如果 status 不是 in_progress，主动清空 progress（用户主动清除意图）
        if (status !== 'in_progress') patch.progress = null
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
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
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
