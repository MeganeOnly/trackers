import { useModeStore } from '../store/mode'

interface TopBarProps {
  onAdd?: () => void
}

export function TopBar({ onAdd }: TopBarProps): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="app-title">书架追踪</h1>
      </div>
      <div className="topbar-center">
        <input
          type="search"
          placeholder="搜索书名 / 作者..."
          className="search-input"
        />
      </div>
      <div className="topbar-right">
        <div className="mode-toggle" role="tablist" aria-label="模式">
          <button
            role="tab"
            aria-selected={mode === 'clean'}
            className={mode === 'clean' ? 'active' : ''}
            onClick={() => setMode('clean')}
          >
            日常模式
          </button>
          <button
            role="tab"
            aria-selected={mode === 'edit'}
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => setMode('edit')}
          >
            编辑模式
          </button>
        </div>
        <button className="add-btn" onClick={onAdd} title="加书 (Phase 5)">
          + 加书
        </button>
      </div>
    </header>
  )
}
