import { useMemo, useState } from 'react'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import { useGraphAnalysis, useUnlocked } from '../store/selectors'
import { useSearchStore, matchGoal } from '../store/search'
import { useSettingsStore } from '../store/settings'
import { isGoalDone } from '@shared/types'
import { computeDailyHidden } from '@shared/visibility'
import { URGENCY_WEIGHT, daysUntil, urgencyOf } from '@shared/deadline'
import { categoryVar } from '@shared/categoryColor'
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

export function CleanMode({ onOpenAnalyze }: { onOpenAnalyze?: () => void } = {}): JSX.Element {
  const goals = useGoalsStore((s) => s.goals)
  const update = useGoalsStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()
  const analysis = useGraphAnalysis()
  const query = useSearchStore((s) => s.query)
  const format = useSettingsStore((s) => s.format)

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
        {onOpenAnalyze && goals.length > 0 && (
          <button className="analyze-summary" onClick={onOpenAnalyze} title="打开图分析">
            <span
              className="analyze-summary-score"
              style={{
                color:
                  analysis.healthScore >= 80
                    ? '#2d5a3a'
                    : analysis.healthScore >= 60
                      ? '#c89456'
                      : '#c0573d'
              }}
            >
              {analysis.healthScore}
            </span>
            <span className="muted">/100</span>
            <span className="analyze-summary-sep">·</span>
            <span className="analyze-summary-item">{analysis.orphans.length} 孤立</span>
            <span className="analyze-summary-sep">·</span>
            <span className="analyze-summary-item">{analysis.bottlenecks.length} 瓶颈</span>
          </button>
        )}
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

      {format === 'focus-stack' ? (
        <FocusStackView
          doableList={doableList}
          doneList={goals
            .filter((g) => g.status === 'done')
            .sort((a, b) => b.updated.localeCompare(a.updated))}
          focalGoal={nowInProgress[0]}
          query={query}
          onDone={markDone}
          onShelve={shelve}
          onAbandon={abandon}
          onHide={hide}
        />
      ) : (
        <>
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
                  <li
                    key={goal.id}
                    className="clean-item"
                    style={{ '--item-stripe': categoryVar(goal.category) } as React.CSSProperties}
                  >
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
                      <span className="tracker-id">{goal.id}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
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

/* ============================================================
 * focus-stack 视图:三段式(focal card + compact list + stamp wall)
 * 与 list / grid 平行的另一种 format,差异点在 CleanMode 布局结构。
 * ============================================================ */
interface FocusStackViewProps {
  doableList: { goal: Goal; refCount: number }[]
  doneList: Goal[]
  focalGoal: Goal | undefined
  query: string
  onDone: (id: string) => Promise<void>
  onShelve: (id: string) => Promise<void>
  onAbandon: (id: string) => Promise<void>
  onHide: (id: string) => Promise<void>
}

function FocusStackView({
  doableList,
  doneList,
  focalGoal,
  query,
  onDone,
  onShelve,
  onAbandon,
  onHide
}: FocusStackViewProps): JSX.Element {
  return (
    <div className="focus-stack">
      {/* 焦点卡:pinned in_progress 的目标 / 没有就不渲染 */}
      {focalGoal && (
        <section
          className="focal-card"
          style={{ '--item-stripe': categoryVar(focalGoal.category) } as React.CSSProperties}
        >
          <div className="focal-card-label">
            <span className="focal-card-eyebrow muted">当前焦点 · 进行中</span>
            <span className="tracker-id">{focalGoal.id}</span>
          </div>
          <h2 className="focal-card-title">{focalGoal.title}</h2>
          <div className="focal-card-meta muted">
            {focalGoal.category || '未分类'}
            {focalGoal.deadline && (
              <span className={`focal-card-deadline ${urgencyClass(urgencyOf(focalGoal.deadline)) ?? ''}`}>
                {' · '}
                截止 {focalGoal.deadline}
                {urgencyOf(focalGoal.deadline) === 'overdue' &&
                  ` 已逾期 ${Math.abs(focalGoal.deadline ? daysUntil(focalGoal.deadline) ?? 0 : 0)} 天`}
              </span>
            )}
          </div>
          {focalGoal.progress && focalGoal.progress.total !== null && (
            <div className="focal-card-progress">
              <span className="focal-card-progress-text">
                {focalGoal.progress.current}/{focalGoal.progress.total}
              </span>
              <div className="focal-card-progress-bar">
                <div
                  className="focal-card-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.round((focalGoal.progress.current / focalGoal.progress.total) * 100))}%`
                  }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* 紧凑清单:现在能推进的目标(去掉 kind-tag / 操作按钮,只留标题 + deadline + ref-count) */}
      {doableList.length > 0 && (
        <section className="compact-list-section">
          <h3 className="compact-list-header">现在能推进 · {doableList.length}</h3>
          <ul className="compact-list">
            {doableList.map(({ goal, refCount }) => {
              const u = urgencyOf(goal.deadline)
              return (
                <li
                  key={goal.id}
                  className="compact-item"
                  style={{ '--item-stripe': categoryVar(goal.category) } as React.CSSProperties}
                >
                  <span className="compact-item-title">{goal.title}</span>
                  <span className="compact-item-meta muted">
                    {goal.category && <span>{goal.category}</span>}
                    {goal.deadline && (
                      <span className={urgencyClass(u)}>
                        {goal.category ? ' · ' : ''}截止 {goal.deadline}
                      </span>
                    )}
                    {refCount > 0 && <span> · 解锁 {refCount} 个</span>}
                  </span>
                  <span className="compact-item-actions">
                    <button
                      className="btn-secondary btn-tiny"
                      onClick={() => void onDone(goal.id)}
                      title="标记为已达成"
                    >
                      达成
                    </button>
                    <button
                      className="btn-secondary btn-tiny"
                      onClick={() => void onShelve(goal.id)}
                      title="搁置"
                    >
                      搁置
                    </button>
                    <button
                      className="btn-secondary btn-tiny"
                      onClick={() => void onAbandon(goal.id)}
                      title="放弃"
                    >
                      放弃
                    </button>
                    <button
                      className="btn-secondary btn-tiny"
                      onClick={() => void onHide(goal.id)}
                      title="在日常模式『现在能推进』中收起（隐藏）"
                    >
                      收起
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* 印章墙:已达成目标横排,每条带 StampChip 印章 */}
      {doneList.length > 0 && (
        <section className="stamp-wall">
          <h3 className="stamp-wall-header">印章墙 · 已达成 {doneList.length}</h3>
          <div className="stamp-wall-grid">
            {doneList.map((g) => (
              <article
                key={g.id}
                className="stamp-card"
                style={{ '--item-stripe': categoryVar(g.category) } as React.CSSProperties}
              >
                <span className="stamp-card-id muted">№ {g.id}</span>
                <h4 className="stamp-card-title">{g.title}</h4>
                <span className="stamp-card-category muted">{g.category || '未分类'}</span>
                <span className="tracker-stamp" data-state="done">已达成</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {doableList.length === 0 && !focalGoal && doneList.length === 0 && (
        <p className="muted empty-hint">
          {query ? '无匹配。' : '暂无已解锁的目标。先在右侧编辑模式加几个。'}
        </p>
      )}
    </div>
  )
}
