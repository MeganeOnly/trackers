import { useGroupedByStatus } from '../store/selectors'
import { useGoalsStore } from '../store/goals'
import { useSearchStore, matchGoal } from '../store/search'
import type { Goal, GoalStatus } from '@shared/types'

const STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

const STATUS_ORDER: GoalStatus[] = ['in_progress', 'not_started', 'done', 'shelved', 'abandoned']

function StatusDot({ status }: { status: GoalStatus }): JSX.Element {
  return <span className={`status-dot status-${status}`} title={STATUS_LABELS[status]} />
}

export function GoalList(): JSX.Element {
  const groups = useGroupedByStatus()
  const selectedId = useGoalsStore((s) => s.selectedId)
  const select = useGoalsStore((s) => s.select)
  const query = useSearchStore((s) => s.query)

  // 编辑模式侧栏"已收起"分组：跨 status 收集所有 collapsed=true 的目标，
  // 它们不再出现在原 status 分组里。语义与 CleanMode 的 hidden 字段完全独立。
  const collapsedItems = (): Goal[] => groups.in_progress
    .concat(groups.not_started, groups.done, groups.shelved, groups.abandoned)
    .filter((g) => g.collapsed)

  const filtered = (items: Goal[]): Goal[] =>
    items.filter((b) => matchGoal(b, query)).filter((b) => !b.collapsed)

  return (
    <div className="goal-list">
      {STATUS_ORDER.map((status) => {
        const items = filtered(groups[status])
        const totalCount = groups[status].length
        return (
          <section key={status} className="goal-list-group">
            <h3>
              <StatusDot status={status} />
              {STATUS_LABELS[status]}{' '}
              <span className="count">
                ({query ? `${items.length}/${totalCount}` : totalCount})
              </span>
            </h3>
            {items.length === 0 ? (
              <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
            ) : (
              <ul>
                {items.map((g) => (
                  <li
                    key={g.id}
                    className={selectedId === g.id ? 'selected' : ''}
                    onClick={() => select(g.id)}
                  >
                    <span className="title">{g.title}</span>
                    {g.status === 'in_progress' && g.progress && (
                      <span className="read-count">
                        {g.progress.total !== null
                          ? `${g.progress.current}/${g.progress.total}`
                          : `${g.progress.current}+`}
                      </span>
                    )}
                    {g.status !== 'in_progress' && g.deadline && (
                      <span className="read-count">截止 {g.deadline}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {/* 编辑模式"已收起"分组：跨 status 收集 collapsed=true 的目标；不影响 CleanMode 任何行为 */}
      <CollapsedSection items={collapsedItems()} />
    </div>
  )
}

interface CollapsedSectionProps {
  items: Goal[]
}

function CollapsedSection({ items }: CollapsedSectionProps): JSX.Element | null {
  const selectedId = useGoalsStore((s) => s.selectedId)
  const select = useGoalsStore((s) => s.select)
  const query = useSearchStore((s) => s.query)
  const filtered = items.filter((g) => matchGoal(g, query))
  if (items.length === 0) return null
  return (
    <section className="goal-list-group goal-list-group--collapsed">
      <h3>
        <span className="status-dot status-collapsed" title="在编辑模式侧栏已收起" />
        已收起{' '}
        <span className="count">
          ({query ? `${filtered.length}/${items.length}` : items.length})
        </span>
      </h3>
      {filtered.length === 0 ? (
        <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
      ) : (
        <ul>
          {filtered.map((g) => (
            <li
              key={g.id}
              className={selectedId === g.id ? 'selected' : ''}
              onClick={() => select(g.id)}
            >
              <span className="title">{g.title}</span>
              <span className="read-count">{STATUS_LABELS[g.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
