import { useMemo, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { detectCycles } from '@core'
import type { Goal, Edge, UnlockRule } from '@shared/types'

interface PrereqEditorProps {
  goalId: string
}

const STATUS_LABELS: Record<Goal['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

export function PrereqEditor({ goalId }: PrereqEditorProps): JSX.Element {
  const goals = useGoalsStore((s) => s.goals)
  const edges = useRelationsStore((s) => s.edges)
  const setAll = useRelationsStore((s) => s.setAll)
  const select = useGoalsStore((s) => s.select)

  const myEdge = edges.find((e) => e.to === goalId)
  const prereqIds = myEdge?.prerequisites ?? []
  const rule: UnlockRule = myEdge?.rule ?? 'all'
  const threshold = myEdge?.threshold ?? prereqIds.length

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const prereqGoals = prereqIds
    .map((id) => goals.find((b) => b.id === id))
    .filter((b): b is Goal => Boolean(b))
  const missingIds = prereqIds.filter((id) => !goals.some((b) => b.id === id))

  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return goals
      .filter((b) => b.id !== goalId)
      .filter((b) => !prereqIds.includes(b.id))
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.category.toLowerCase().includes(q))
      .slice(0, 12)
  }, [goals, goalId, prereqIds, pickerQuery])

  async function persist(next: { prerequisites: string[]; rule: UnlockRule; threshold?: number }): Promise<void> {
    const others = edges.filter((e) => e.to !== goalId)
    const newEdge: Edge | null =
      next.prerequisites.length === 0 && next.rule === 'all'
        ? null
        : {
            to: goalId,
            prerequisites: next.prerequisites,
            rule: next.rule,
            ...(next.rule === 'any_of' ? { threshold: next.threshold ?? next.prerequisites.length } : {})
          }
    const updated = newEdge ? [...others, newEdge] : others

    // 写之前做一次环检测
    const cycles = detectCycles(updated)
    const inCycle = cycles.some((c) => c.includes(goalId))
    if (inCycle) {
      alert('此修改会造成循环依赖，请先调整其他前置。')
      return
    }
    await setAll(updated)
  }

  async function remove(id: string): Promise<void> {
    await persist({
      prerequisites: prereqIds.filter((p) => p !== id),
      rule,
      threshold
    })
  }

  async function add(id: string): Promise<void> {
    setPickerOpen(false)
    setPickerQuery('')
    await persist({
      prerequisites: [...prereqIds, id],
      rule,
      threshold
    })
  }

  async function setRule(r: UnlockRule): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: r,
      threshold: r === 'any_of' ? Math.max(1, threshold) : undefined
    })
  }

  async function setThreshold(n: number): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: 'any_of',
      threshold: n
    })
  }

  return (
    <section className="detail-prereqs">
      <h3>
        前置依赖 <span className="muted">({prereqIds.length} 个)</span>
      </h3>

      {prereqIds.length > 0 && (
        <div className="rule-row">
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'all'}
              onChange={() => setRule('all')}
            />
            <span>全部达成才解锁</span>
          </label>
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'any_of'}
              onChange={() => setRule('any_of')}
            />
            <span>至少</span>
            <input
              type="number"
              min={1}
              max={prereqIds.length}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.min(prereqIds.length, Number(e.target.value) || 1)))}
              disabled={rule !== 'any_of'}
              className="threshold-input"
            />
            <span>个解锁</span>
          </label>
        </div>
      )}

      <ul>
        {prereqGoals.map((p) => (
          <li key={p.id} className={`prereq status-${p.status}`}>
            <span className="title" onClick={() => select(p.id)}>{p.title}</span>
            <span className={`status-tag status-${p.status}`}>{STATUS_LABELS[p.status]}</span>
            <button className="prereq-remove" onClick={() => remove(p.id)} title="移除前置">×</button>
          </li>
        ))}
        {missingIds.map((id) => (
          <li key={id} className="prereq prereq-missing">
            <span className="title">{id}</span>
            <span className="muted">未找到</span>
            <button className="prereq-remove" onClick={() => remove(id)}>×</button>
          </li>
        ))}
        {prereqIds.length === 0 && <li className="muted empty-hint">无前置 —— 此目标永远解锁</li>}
      </ul>

      <button className="add-prereq" onClick={() => setPickerOpen((v) => !v)}>
        + 添加前置
      </button>

      {pickerOpen && (
        <div className="prereq-picker">
          <input
            type="search"
            placeholder="搜索目标 / 分类..."
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
          />
          <ul>
            {candidates.length === 0 ? (
              <li className="muted">无匹配</li>
            ) : (
              candidates.map((b) => (
                <li key={b.id} onClick={() => add(b.id)}>
                  <span className="title">{b.title}</span>
                  <span className="author muted">{b.category || ''}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </section>
  )
}
