// packages/tracker-ui/src/GraphView/NodeSidebar.tsx
//
// 关系图节点列表侧栏 —— 按 status 分组 + 字母序，点击触发 onSelect。
//
// 共享层只管 UI + 折叠；分组 / 排序由 app 端 useMemo 提供。
//
// 视觉：
//   - 左侧固定 240px 宽，半透明白底
//   - 顶部 X 折叠按钮（变最右贴边一窄条，点击展开）
//   - 每组 header（小写）+ 列表项（标题 + 选中态）
//   - 列表项 hover / active 高亮

import type { ReactNode } from 'react'

export interface SidebarGroupItem {
  id: string
  title: string
  /** 节点色点（图例色），可选 */
  color?: string
}

export interface SidebarGroup {
  id: string
  label: string
  items: SidebarGroupItem[]
}

interface NodeSidebarProps {
  open: boolean
  onToggle: () => void
  groups: SidebarGroup[]
  selectedId: string | null
  highlightId?: string | null
  onSelect: (id: string) => void
  /** 顶部可注入额外控件（如搜索框） */
  headerSlot?: ReactNode
}

const SIDEBAR_W = 240

export function NodeSidebar({
  open,
  onToggle,
  groups,
  selectedId,
  highlightId,
  onSelect,
  headerSlot
}: NodeSidebarProps): JSX.Element {
  if (!open) {
    /* 折叠态：右侧贴边一条，箭头朝右表示"展开" */
    return (
      <button
        type="button"
        className="graph-sidebar-handle"
        onClick={onToggle}
        title="展开节点列表"
        aria-label="展开节点列表"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    )
  }

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <aside className="graph-sidebar" aria-label="节点列表" style={{ width: SIDEBAR_W }}>
      <div className="graph-sidebar-header">
        <strong>节点列表（{totalCount}）</strong>
        <button
          type="button"
          className="graph-sidebar-close"
          onClick={onToggle}
          title="折叠节点列表"
          aria-label="折叠节点列表"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>
      {headerSlot && <div className="graph-sidebar-header-slot">{headerSlot}</div>}
      <div className="graph-sidebar-body">
        {groups.map((g) => (
          <section key={g.id} className="graph-sidebar-group">
            <h4>
              {g.label}（{g.items.length}）
            </h4>
            {g.items.length === 0 ? (
              <p className="muted graph-sidebar-empty">（空）</p>
            ) : (
              <ul>
                {g.items.map((it) => {
                  const isSelected = it.id === selectedId
                  const isHighlight = it.id === highlightId
                  return (
                      <li key={it.id}>
                        <button
                          type="button"
                          className={
                            'graph-sidebar-item' +
                            (isSelected ? ' selected' : '') +
                            (isHighlight ? ' highlighted' : '')
                          }
                          onClick={() => onSelect(it.id)}
                          title={it.title}
                        >
                          {it.color && (
                            <span className="graph-sidebar-dot" style={{ background: it.color }} />
                          )}
                          <span className="graph-sidebar-title">{it.title}</span>
                        </button>
                      </li>
                    )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </aside>
  )
}