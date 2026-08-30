// packages/tracker-ui/src/GraphView/FiltersPanel.tsx
//
// 关系图过滤面板 —— 多选 tag / status、孤立开关、最少入度阈值。
//
// 数据流：
//   - filters + setters 由 useGraphFilters 提供（持久化到 localStorage）
//   - availableTags / availableStatuses 由 app 端从数据中提取
//     （共享层不感知 book / life 的 status 字符串）
//   - maxRefCount = max(...nodes.refCount)（入度阈值上限）
//
// 视觉：
//   - 浮窗（position: absolute），左下角，齿轮按钮触发
//   - 每行 checkbox + label；status 行额外有色点（app 端 statusColors 注入）
//   - 0 节点可见时中央提示"无匹配节点"+清空过滤按钮（在 GraphView 主区渲染）

import { useEffect } from 'react'

export interface StatusOption {
  value: string
  label: string
  color: string
}

interface FiltersPanelProps {
  filters: {
    tags: string[]
    statuses: string[]
    showOrphans: boolean
    minRefCount: number
  }
  setTags: (tags: string[]) => void
  setStatuses: (statuses: string[]) => void
  setShowOrphans: (v: boolean) => void
  setMinRefCount: (v: number) => void
  resetFilters: () => void
  availableTags: string[]
  availableStatuses: StatusOption[]
  maxRefCount: number
  onClose: () => void
}

export function FiltersPanel({
  filters,
  setTags,
  setStatuses,
  setShowOrphans,
  setMinRefCount,
  resetFilters,
  availableTags,
  availableStatuses,
  maxRefCount,
  onClose
}: FiltersPanelProps): JSX.Element {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleTag = (tag: string): void => {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag]
    setTags(next)
  }

  const toggleStatus = (status: string): void => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status]
    setStatuses(next)
  }

  return (
    <div className="filters-panel" role="dialog" aria-label="过滤">
      <div className="filters-header">
        <strong>过滤</strong>
        <button type="button" className="filters-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="filters-body">
        {availableTags.length > 0 && (
          <section className="filters-section">
            <h4>标签（{availableTags.length}）</h4>
            <div className="filters-chips">
              {availableTags.map((tag) => {
                const active = filters.tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={'filters-chip' + (active ? ' active' : '')}
                    onClick={() => toggleTag(tag)}
                    aria-pressed={active}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <section className="filters-section">
          <h4>状态（{availableStatuses.length}）</h4>
          <div className="filters-status-list">
            {availableStatuses.map((s) => {
              const active = filters.statuses.includes(s.value)
              return (
                <label key={s.value} className="filters-status-row">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleStatus(s.value)}
                  />
                  <span className="filters-status-dot" style={{ background: s.color }} />
                  <span className="filters-status-label">{s.label}</span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="filters-section">
          <h4>最少入度（{filters.minRefCount}）</h4>
          <input
            type="range"
            min={0}
            max={Math.max(maxRefCount, 0)}
            step={1}
            value={filters.minRefCount}
            onChange={(e) => setMinRefCount(Number(e.target.value))}
            className="filters-slider"
          />
        </section>

        <section className="filters-section">
          <label className="filters-switch-row">
            <input
              type="checkbox"
              checked={filters.showOrphans}
              onChange={(e) => setShowOrphans(e.target.checked)}
            />
            <span>显示孤立节点（refCount = 0）</span>
          </label>
        </section>

        <button type="button" className="filters-reset" onClick={resetFilters}>
          清空过滤
        </button>
      </div>
    </div>
  )
}