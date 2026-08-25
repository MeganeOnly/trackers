import { useMemo, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { useSearchStore, matchGoal } from '../store/search'
import { isGoalDone } from '@shared/types'
import type { Goal, GoalStatus } from '@shared/types'

const COLLAPSED_SECTIONS: { key: GoalStatus; label: string }[] = [
  { key: 'shelved', label: '搁置' },
  { key: 'done', label: '已达成' },
  { key: 'abandoned', label: '放弃' }
]

/** 折叠区条目"恢复"的目标状态：搁置/放弃 → 未开始，已达成 → 进行中 */
const RESTORE_TO: Record<GoalStatus, GoalStatus> = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  done: 'in_progress',
  shelved: 'not_started',
  abandoned: 'not_started'
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function CleanMode(): JSX.Element {
  const goals = useGoalsStore((s) => s.goals)
  const update = useGoalsStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()
  const query = useSearchStore((s) => s.query)

  const [openSections, setOpenSections] = useState<Set<GoalStatus>>(new Set())

  const nowInProgress = useMemo(
    () => goals.filter((g) => g.status === 'in_progress' && g.pinned),
    [goals]
  )

  const doableList = useMemo(() => {
    const refCount = new Map<string, number>()
    for (const g of goals) refCount.set(g.id, 0)
    for (const e of edges) {
      for (const p of e.prerequisites) refCount.set(p, (refCount.get(p) ?? 0) + 1)
    }
    return goals
      .filter((g) => g.status !== 'done' && g.status !== 'abandoned' && g.status !== 'shelved')
      .filter((g) => unlocked.get(g.id))
      .filter((g) => matchGoal(g, query))
      .map((goal) => ({ goal, refCount: refCount.get(goal.id) ?? 0 }))
      .sort((a, b) => {
        if (b.refCount !== a.refCount) return b.refCount - a.refCount
        return a.goal.title.localeCompare(b.goal.title, 'zh')
      })
  }, [goals, edges, unlocked, query])

  const collapsedLists: Record<GoalStatus, Goal[]> = useMemo(() => {
    const groups: Record<GoalStatus, Goal[]> = {
      not_started: [],
      in_progress: [],
      done: [],
      shelved: [],
      abandoned: []
    }
    for (const g of goals) groups[g.status].push(g)
    for (const k of Object.keys(groups) as GoalStatus[]) {
      groups[k] = groups[k]
        .filter((g) => matchGoal(g, query))
        .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    }
    return groups
  }, [goals, query])

  async function markDone(id: string): Promise<void> {
    await update(id, { status: 'done' })
  }
  async function shelve(id: string): Promise<void> {
    await update(id, { status: 'shelved' })
  }
  async function restore(g: Goal): Promise<void> {
    await update(g.id, { status: RESTORE_TO[g.status] })
  }

  function toggle(key: GoalStatus): void {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="page-clean">
      <header className="clean-header">
        <h2>
          现在能推进的目标 ({doableList.length}
          {query && doableList.length !== goals.length ? ` / ${goals.length}` : ''})
        </h2>
        {nowInProgress.length > 0 && (
          <p className="currently-reading">
            <span>进行中: </span>
            {nowInProgress.map((g, i) => (
              <span key={g.id} className="currently-item">
                {i > 0 && <span className="currently-sep">、</span>}
                <strong>{g.title}</strong>
                {g.deadline && ` · 截止 ${g.deadline}`}
                {g.progress && (
                  <span className="currently-progress">
                    {g.progress.total !== null
                      ? ` · ${g.progress.current}/${g.progress.total}`
                      : g.progress.current > 0
                        ? ` · ${g.progress.current}`
                        : ''}
                  </span>
                )}
              </span>
            ))}
          </p>
        )}
      </header>

      {doableList.length === 0 ? (
        <p className="muted empty-hint">
          {query ? '无匹配。' : '暂无已解锁的目标。先在右侧编辑模式加几个。'}
        </p>
      ) : (
        <ul className="clean-list">
          {doableList.map(({ goal, refCount }) => {
            const overdue = !!goal.deadline && goal.deadline < todayStr()
            return (
              <li key={goal.id} className="clean-item">
                <div className="clean-item-left">
                  <span className="title">{goal.title}</span>
                  <span className="author muted">
                    {goal.category || '未分类'}
                    {goal.deadline && (
                      <span className={overdue ? 'deadline-overdue' : undefined}>
                        {' · '}
                        {goal.deadline}
                        {overdue && ' 已逾期'}
                      </span>
                    )}
                    {goal.progress &&
                      goal.progress.total !== null &&
                      goal.progress.current >= goal.progress.total && (
                        <span className="auto-done-hint"> · 进度已满</span>
                      )}
                  </span>
                </div>
                <div className="clean-item-right">
                  <span
                    className="ref-badge"
                    style={{ visibility: refCount > 0 ? 'visible' : 'hidden' }}
                    aria-hidden={refCount > 0 ? undefined : true}
                  >
                    解锁 {refCount} 个
                  </span>
                  <div className="quick-actions">
                    <button className="btn-secondary" onClick={() => shelve(goal.id)} title="搁置">
                      搁置
                    </button>
                    <button
                      className="quick-finish"
                      onClick={() => markDone(goal.id)}
                      title="标记为已达成"
                    >
                      达成
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="collapsed-sections">
        {COLLAPSED_SECTIONS.map(({ key, label }) => {
          const items = collapsedLists[key]
          const open = openSections.has(key)
          return (
            <section key={key} className={`collapsed-section status-${key}`}>
              <button
                className="collapsed-header"
                onClick={() => toggle(key)}
                aria-expanded={open}
              >
                <span className={`status-dot status-${key}`} />
                <span className="label">{label}</span>
                <span className="count muted">({items.length})</span>
                <span className="caret">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <ul className="collapsed-list">
                  {items.length === 0 ? (
                    <li className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</li>
                  ) : (
                    items.map((g) => (
                      <li key={g.id} className="collapsed-item">
                        <span className="title">{g.title}</span>
                        <span className="author muted">
                          {g.status === 'done' &&
                          isGoalDone(g) &&
                          g.progress &&
                          g.progress.total !== null
                            ? `${g.progress.current}/${g.progress.total}`
                            : g.category || ''}
                        </span>
                        <button className="restore-btn" onClick={() => restore(g)} title="恢复">
                          恢复
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
