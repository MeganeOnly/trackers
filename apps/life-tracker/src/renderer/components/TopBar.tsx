// apps/life-tracker/src/renderer/components/TopBar.tsx
//
// 目标领域 TopBar —— 共享 BaseTopBar 的 life-tracker 包装。
//
// 框架代码（<header> / 搜索 / mode 切换 / / 快捷键 / 共有按钮）下沉到
// packages/tracker-ui 的 BaseTopBar。这里只剩领域差异：
//   - title = "目标追踪"
//   - searchPlaceholder = "搜索目标 / 分类 (按 / 聚焦)"
//   - add 按钮文案 = "+ 加目标"
//   - 领域按钮：onTrash（带 trashCount 角标）/ onAnalyze（slot 注入）

import { useEffect } from 'react'
import { useModeStore } from '../store/mode'
import { useSearchStore } from '../store/search'
import { useTrashStore } from '../store/trash'
import { BaseTopBar } from '@ui/BaseTopBar'

interface TopBarProps {
  onAdd?: () => void
  onGraph?: () => void
  onTrash?: () => void
  onSettings?: () => void
  onAnalyze?: () => void
}

export function TopBar({ onAdd, onGraph, onTrash, onSettings, onAnalyze }: TopBarProps): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.set)
  const trashCount = useTrashStore((s) => s.entries.length)
  const loadTrash = useTrashStore((s) => s.load)

  // 启动后拉一次回收站列表（让 TopBar 的角标数字准确）。
  // 后续打开 TrashModal 时会再拉一次（force refresh）。
  useEffect(() => {
    void loadTrash()
  }, [loadTrash])

  return (
    <BaseTopBar
      title="目标追踪"
      searchPlaceholder="搜索目标 / 分类 (按 / 聚焦)"
      searchQuery={query}
      onSearchQueryChange={setQuery}
      mode={mode}
      onModeChange={setMode}
      addButtonLabel="+ 加目标"
      addButtonTitle="加目标 (n)"
      onAdd={onAdd}
      onGraph={onGraph}
      onSettings={onSettings}
    >
      {onTrash && (
        <button
          className="topbar-icon-btn topbar-icon-btn--with-badge"
          onClick={onTrash}
          title={trashCount > 0 ? `回收站 (${trashCount})` : '回收站'}
        >
          <span>回收站</span>
          {trashCount > 0 && <span className="badge">{trashCount}</span>}
        </button>
      )}
      {onAnalyze && (
        <button className="topbar-icon-btn" onClick={onAnalyze} title="图分析 (a)">
          分析
        </button>
      )}
    </BaseTopBar>
  )
}
