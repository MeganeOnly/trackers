// apps/book-tracker/src/renderer/components/TopBar.tsx
//
// 书籍领域 TopBar —— 共享 BaseTopBar 的 book-tracker 包装。
//
// 框架代码（<header> / 搜索 / mode 切换 / / 快捷键 / 共有按钮）下沉到
// packages/tracker-ui 的 BaseTopBar。这里只剩领域差异：
//   - title = "作品追踪"
//   - searchPlaceholder = "搜索作品名 / 作者 (按 / 聚焦)"
//   - add 按钮文案 = "+ 添加"（涵盖 + 作品 / + 系列 tab）
//   - 领域按钮：onRanking / onCandidates（slot 注入到 BaseTopBar）

import { useModeStore } from '../store/mode'
import { useSearchStore } from '../store/search'
import { BaseTopBar } from '@ui/BaseTopBar'

interface TopBarProps {
  onAdd?: () => void
  onGraph?: () => void
  onRanking?: () => void
  onSettings?: () => void
  /** v2.x：候选剧集 modal 入口（独立于设置面板） */
  onCandidates?: () => void
}

export function TopBar({ onAdd, onGraph, onRanking, onSettings, onCandidates }: TopBarProps): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.set)

  return (
    <BaseTopBar
      title="作品追踪"
      searchPlaceholder="搜索作品名 / 作者 (按 / 聚焦)"
      searchQuery={query}
      onSearchQueryChange={setQuery}
      mode={mode}
      onModeChange={setMode}
      addButtonLabel="+ 添加"
      addButtonTitle="加作品 / 系列 (n)"
      onAdd={onAdd}
      onGraph={onGraph}
      onSettings={onSettings}
    >
      {onCandidates && (
        // v2.x：候选剧集入口放在「设置」右边 —— 不再嵌在设置面板内
        <button className="topbar-icon-btn" onClick={onCandidates} title="待选剧集">
          待选
        </button>
      )}
      {onRanking && (
        <button className="topbar-icon-btn" onClick={onRanking} title="排名 (r)">
          排
        </button>
      )}
    </BaseTopBar>
  )
}
