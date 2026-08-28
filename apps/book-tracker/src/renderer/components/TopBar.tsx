import { useEffect, useRef } from 'react'
import { useModeStore } from '../store/mode'
import { useSearchStore } from '../store/search'

interface TopBarProps {
  onAdd?: () => void
  onGraph?: () => void
  onRanking?: () => void
  onSettings?: () => void
}

export function TopBar({ onAdd, onGraph, onRanking, onSettings }: TopBarProps): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)
  const query = useSearchStore((s) => s.query)
  const setQuery = useSearchStore((s) => s.set)
  const inputRef = useRef<HTMLInputElement>(null)

  // '/' 快捷键聚焦搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === '/') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="app-title">作品追踪</h1>
      </div>
      <div className="topbar-center">
        <input
          ref={inputRef}
          type="search"
          placeholder="搜索作品名 / 作者 (按 / 聚焦)"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      <div className="topbar-right">
        {onSettings && (
          <button className="topbar-icon-btn" onClick={onSettings} title="设置">
            ⚙
          </button>
        )}
        {onGraph && (
          <button className="topbar-icon-btn" onClick={onGraph} title="关系图 (g)">
            图
          </button>
        )}
        {onRanking && (
          <button className="topbar-icon-btn" onClick={onRanking} title="排名 (r)">
            排
          </button>
        )}
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
        <button className="add-btn" onClick={onAdd} title="加作品 (n)">
          + 加作品
        </button>
      </div>
    </header>
  )
}
