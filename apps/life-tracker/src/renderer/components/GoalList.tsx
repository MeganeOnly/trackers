import { useCallback, useEffect, useMemo, useState } from 'react'
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
/**
 * 侧栏常规分组渲染顺序：「放弃」按用户要求仅在「被收起」bucket 内出现，
 * 所以常规 4 组只用 in_progress / not_started / done / shelved。
 */
const REGULAR_STATUS_ORDER: GoalStatus[] = ['in_progress', 'not_started', 'done', 'shelved']
/**
 * 「被收起」bucket 内的子分组渲染顺序：全 5 个 status 都展示，
 * 包括 abandoned —— 放弃的目标一律归 bucket（用户明确要求"放弃仅在收起中"）。
 */
const BUCKET_STATUS_ORDER: GoalStatus[] = STATUS_ORDER

/**
 * 判断目标是否该归到「被收起」bucket：
 * - 用户手动勾 `collapsed` 走通用路径；
 * - status === 'abandoned' 时**无论** collapsed 是 true 还是 false，一律归
 *   bucket（语义：放弃等同于收起，与隐藏 / 清理语义捆绑）。
 */
function inBucket(g: Goal, status: GoalStatus): boolean {
  return g.collapsed || status === 'abandoned'
}

/** localStorage 持久化键：哪些侧栏 section 当前处于『收起』状态 */
const COLLAPSED_SECTIONS_STORAGE_KEY = 'life-tracker:sidebar:collapsed-sections'

/**
 * 侧栏 section 可折叠状态 hook：
 * - 用字符串集合存当前收起的 section（不在集合里的 = 展开）；
 * - 自动同步到 localStorage，刷新页面保持上次状态；
 * - 解析失败兜底返回空集（优雅降级）。
 */
function useCollapsibleSections(): {
  isCollapsed: (key: string) => boolean
  toggle: (key: string) => void
} {
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  })

  const isCollapsed = useCallback(
    (key: string) => collapsed.includes(key),
    [collapsed]
  )

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* localStorage 不可用（隐私模式 / quota）不影响 in-memory 状态 */
      }
      return next
    })
  }, [])

  // 跨多 tab 同步：localStorage 更新时让本 tab 跟随
  useEffect(() => {
    function onStorage(e: StorageEvent): void {
      if (e.key !== COLLAPSED_SECTIONS_STORAGE_KEY || e.newValue === null) return
      try {
        const parsed = JSON.parse(e.newValue)
        if (Array.isArray(parsed)) {
          setCollapsed(parsed.filter((k): k is string => typeof k === 'string'))
        }
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { isCollapsed, toggle }
}

function StatusDot({ status }: { status: GoalStatus }): JSX.Element {
  return <span className={`status-dot status-${status}`} title={STATUS_LABELS[status]} />
}

interface ItemRowProps {
  g: Goal
  selected: boolean
  onSelect: (id: string) => void
}

/**
 * 侧栏一行：标题 + 进度 / 截止日期徽标。
 *
 * 不再展示 status 徽标：
 * - 常规 status 分组：每个分组的 section header 已经标了 status 名 + dot，
 *   分组内每条都同 status，多余徽标。
 * - 被收起 bucket 的子分组：同款结构，再加每条 status 徽标跟 sub-header 重复。
 * - 真要看 status：右侧详情面板有「状态」select + status-pill（EditMode 真正的设置位）。
 */
function ItemRow({ g, selected, onSelect }: ItemRowProps): JSX.Element {
  return (
    <li
      className={selected ? 'selected' : ''}
      onClick={() => onSelect(g.id)}
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
  )
}

export function GoalList(): JSX.Element {
  const groups = useGroupedByStatus()
  const selectedId = useGoalsStore((s) => s.selectedId)
  const select = useGoalsStore((s) => s.select)
  const query = useSearchStore((s) => s.query)
  const { isCollapsed, toggle } = useCollapsibleSections()

  // 编辑模式侧栏"被收起"：跨 status 收集 (collapsed=true OR status=abandoned)
  // 的目标，按 status 子分组展示。被 abandoned 直接归 bucket（用户要求"放弃仅在
  // 收起中"），所以常规分组不再渲染 放弃 这一行。
  const collapsedByStatus = useMemo<Record<GoalStatus, Goal[]>>(() => {
    const out: Record<GoalStatus, Goal[]> = {
      not_started: [],
      in_progress: [],
      done: [],
      shelved: [],
      abandoned: []
    }
    for (const status of BUCKET_STATUS_ORDER) {
      out[status] = groups[status].filter((g) => inBucket(g, status))
    }
    return out
  }, [groups])

  const collapsedTotal = useMemo(
    () => BUCKET_STATUS_ORDER.reduce((sum, s) => sum + collapsedByStatus[s].length, 0),
    [collapsedByStatus]
  )

  // 常规分组过滤：搜索匹配 + 排除进 bucket 的（手动 collapsed 或 abandoned）
  const filtered = (items: Goal[], status: GoalStatus): Goal[] =>
    items.filter((b) => matchGoal(b, query)).filter((b) => !inBucket(b, status))

  return (
    <div className="goal-list">
      {REGULAR_STATUS_ORDER.map((status) => {
        const items = filtered(groups[status], status)
        const totalCount = groups[status].length
        const sectionKey = `status:${status}`
        const collapsed = isCollapsed(sectionKey)
        return (
          <section
            key={status}
            className={`goal-list-group goal-list-group--collapsible${collapsed ? ' is-collapsed' : ''}`}
          >
            <button
              type="button"
              className="group-header"
              onClick={() => toggle(sectionKey)}
              aria-expanded={!collapsed}
              title={collapsed ? '点击展开' : '点击收起'}
            >
              <StatusDot status={status} />
              <span className="group-name">{STATUS_LABELS[status]}</span>
              <span className="count">
                ({query ? `${items.length}/${totalCount}` : totalCount})
              </span>
              <span className="caret" aria-hidden="true">
                {collapsed ? '▸' : '▾'}
              </span>
            </button>
            {!collapsed &&
              (items.length === 0 ? (
                <p className="muted empty-hint">{query ? '— 无匹配 —' : '—'}</p>
              ) : (
                <ul>
                  {items.map((g) => (
                    <ItemRow
                      key={g.id}
                      g={g}
                      selected={selectedId === g.id}
                      onSelect={select}
                    />
                  ))}
                </ul>
              ))}
          </section>
        )
      })}

      {/* 「被收起」区域：跨 status 收集 (collapsed=true OR status=abandoned) 的目标，
          按 status 再分子分组（与上方 status 分组同款结构，统一收束到一块 → 用户
          有清晰的『所有被收起的 / 放弃的』位置感）。abandoned 一律归 bucket。 */}
      <CollapsedBucket
        collapsedByStatus={collapsedByStatus}
        collapsedTotal={collapsedTotal}
        selectedId={selectedId}
        onSelect={select}
        query={query}
        isCollapsed={isCollapsed}
        toggle={toggle}
      />
    </div>
  )
}

interface CollapsedBucketProps {
  collapsedByStatus: Record<GoalStatus, Goal[]>
  collapsedTotal: number
  selectedId: string | null
  onSelect: (id: string) => void
  query: string
  isCollapsed: (key: string) => boolean
  toggle: (key: string) => void
}

function CollapsedBucket({
  collapsedByStatus,
  collapsedTotal,
  selectedId,
  onSelect,
  query,
  isCollapsed,
  toggle
}: CollapsedBucketProps): JSX.Element | null {
  if (collapsedTotal === 0) return null
  // 外层 bucket header 自己也走折叠机制（与上方 5 个 status 分组同款 button）：
  // - 折叠 bucket → 整片「被收起」区块（连同子 sub-section）一起折叠
  // - 展开 bucket → 各 sub-section 仍按自己独立的 sectionKey 自管折叠
  const bucketKey = 'collapsed:bucket'
  const bucketCollapsed = isCollapsed(bucketKey)
  return (
    <section
      className={`goal-list-group goal-list-group--collapsed-bucket goal-list-group--collapsible${bucketCollapsed ? ' is-collapsed' : ''}`}
    >
      <button
        type="button"
        className="group-header group-header--bucket"
        onClick={() => toggle(bucketKey)}
        aria-expanded={!bucketCollapsed}
        title={bucketCollapsed ? '点击展开' : '点击收起'}
      >
        <span className="status-dot status-collapsed" title="在编辑模式侧栏已收起" />
        <span className="group-name">被收起</span>
        <span className="count">({collapsedTotal})</span>
        <span className="caret" aria-hidden="true">
          {bucketCollapsed ? '▸' : '▾'}
        </span>
      </button>
      {!bucketCollapsed && (
        <div className="bucket-subs">
          {BUCKET_STATUS_ORDER.map((status) => {
            const items = collapsedByStatus[status].filter((g) => matchGoal(g, query))
            if (items.length === 0) return null
            const totalForStatus = collapsedByStatus[status].length
            const subKey = `collapsed:${status}`
            const subCollapsed = isCollapsed(subKey)
            return (
              <section
                key={status}
                className={`goal-list-group goal-list-group--sub goal-list-group--collapsible${subCollapsed ? ' is-collapsed' : ''}`}
              >
                <button
                  type="button"
                  className="group-header group-header--sub"
                  onClick={() => toggle(subKey)}
                  aria-expanded={!subCollapsed}
                  title={subCollapsed ? '点击展开' : '点击收起'}
                >
                  <StatusDot status={status} />
                  <span className="group-name">{STATUS_LABELS[status]}</span>
                  <span className="count">
                    ({query ? `${items.length}/${totalForStatus}` : totalForStatus})
                  </span>
                  <span className="caret" aria-hidden="true">
                    {subCollapsed ? '▸' : '▾'}
                  </span>
                </button>
                {!subCollapsed && (
                  <ul>
                    {items.map((g) => (
                      <ItemRow
                        key={g.id}
                        g={g}
                        selected={selectedId === g.id}
                        onSelect={onSelect}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}

