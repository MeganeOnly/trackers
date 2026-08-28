import { useMemo, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import { useSearchStore, matchGoal } from '../store/search'
import { isGoalDone } from '@shared/types'
import { computeDailyHidden } from '@shared/visibility'
import { URGENCY_WEIGHT, daysUntil, urgencyOf } from '@shared/deadline'
import type { DeadlineUrgency } from '@shared/deadline'
import type { Goal, GoalStatus } from '@shared/types'

const STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

const COLLAPSED_SECTIONS: { key: string; label: string }[] = [
  { key: 'shelved', label: '搁置' },
  { key: 'done', label: '已达成' },
  { key: 'abandoned', label: '放弃' },
  { key: 'hidden', label: '已收起' }
]

/** 折叠区条目"恢复"的目标状态：搁置/放弃 → 未开始，已达成 → 进行中 */
const RESTORE_TO: Record<GoalStatus, GoalStatus> = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  done: 'in_progress',
  shelved: 'not_started',
  abandoned: 'not_started'
}

/** 紧迫度 → CSS 类名（颜色档位）。 */
function urgencyClass(u: DeadlineUrgency): string | undefined {
  if (u === 'overdue') return 'deadline-overdue'
  if (u === 'urgent') return 'deadline-urgent'
  if (u === 'soon') return 'deadline-soon'
  return undefined
}

export function CleanMode(): JSX.Element {
  const goals = useGoalsStore((s) => s.goals)
  const update = useGoalsStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()
  const query = useSearchStore((s) => s.query)

  const [openSections, setOpenSections] = useState<Set<string>>(new Set())

  const nowInProgress = useMemo(
    () => goals.filter((g) => g.status === 'in_progress' && g.pinned && !g.hidden),
    [goals]
  )

  // ④ 上级（反向前置）被搁置/放弃 → 从可推进列表隐藏
  const blockedByDeadParent = useMemo(() => computeDailyHidden(goals, edges), [goals, edges])

  const doableList = useMemo(() => {
    const refCount = new Map<string, number>()
    for (const g of goals) refCount.set(g.id, 0)
    for (const e of edges) {
      for (const p of e.prerequisites) refCount.set(p, (refCount.get(p) ?? 0) + 1)
    }
    return goals
      .filter((g) => g.status !== 'done' && g.status !== 'abandoned' && g.status !== 'shelved')
      .filter((g) => unlocked.get(g.id))
      .filter((g) => !g.hidden)
      .filter((g) => !blockedByDeadParent.has(g.id))
      .filter((g) => matchGoal(g, query))
      .map((goal) => ({ goal, refCount: refCount.get(goal.id) ?? 0 }))
      .sort((a, b) => {
        // 排序：deadline 紧迫度权重 + 被引用次数（高 = 优先），平手按标题中文序
        const scoreA = URGENCY_WEIGHT[urgencyOf(a.goal.deadline)] + a.refCount
        const scoreB = URGENCY_WEIGHT[urgencyOf(b.goal.deadline)] + b.refCount
        if (scoreA !== scoreB) return scoreB - scoreA
        return a.goal.title.localeCompare(b.goal.title, 'zh')
      })
  }, [goals, edges, unlocked, query, blockedByDeadParent])

  const collapsedLists: Record<string, Goal[]> = useMemo(() => {
    const groups: Record<string, Goal[]> = {
      not_started: [],
      in_progress: [],
      done: [],
      shelved: [],
      abandoned: [],
      hidden: []
    }
    for (const g of goals) {
      if (g.hidden && (g.status === 'not_started' || g.status === 'in_progress')) {
        groups.hidden.push(g)
        continue
      }
      groups[g.status].push(g)
    }
    for (const k of Object.keys(groups)) {
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
  async function abandon(id: string): Promise<void> {
    await update(id, { status: 'abandoned' })
  }
  async function restore(g: Goal): Promise<void> {
    await update(g.id, { status: RESTORE_TO[g.status] })
  }
  async function hide(id: string): Promise<void> {
    await update(id, { hidden: true })
  }
  async function unhide(id: string): Promise<void> {
    await update(id, { hidden: false })
  }

  function toggle(key: string): void {
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
            const u = urgencyOf(goal.deadline)
            const d = goal.deadline ? daysUntil(goal.deadline) : null
            return (
              <li key={goal.id} className="clean-item">
                <div className="clean-item-left">
                  <span className="title">{goal.title}</span>
                  <span className="author muted">
                    {goal.category || '未分类'}
                    {goal.deadline && (
                      <span className={urgencyClass(u)}>
                        {' · '}
                        {goal.deadline}
                        {u === 'overdue' && ` 已逾期 ${Math.abs(d ?? 0)} 天`}
                        {u === 'urgent' && ` 还剩 ${d} 天`}
                        {u === 'soon' && ` ${d} 天后到期`}
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
                    <button
                      className="btn-secondary"
                      onClick={() => hide(goal.id)}
                      title="在日常模式『现在能推进』中收起（隐藏）"
                    >
                      收起
                    </button>
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
                    <button
                      className="btn-secondary quick-abandon"
                      onClick={() => abandon(goal.id)}
                      title="放弃（从可推进列表移除，可恢复）"
                    >
                      放弃
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
                    items.map((g) =>
                      key === 'hidden' ? (
                        <li key={g.id} className="collapsed-item">
                          <span className="title">{g.title}</span>
                          <span className="author muted">{STATUS_LABELS[g.status]}</span>
                          <button
                            className="restore-btn"
                            onClick={() => unhide(g.id)}
                            title="展开（回到『现在能推进』列表）"
                          >
                            展开
                          </button>
                        </li>
                      ) : (
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
                      )
                    )
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
