// packages/tracker-ui/src/BaseTopBar.tsx
//
// 共享 TopBar 基座 —— 两 app 的 TopBar.tsx 都用它做"骨架 + 共有行为"，
// 各自只补领域按钮（用 children slot 注入）。
//
// 设计要点：
// - 框架代码（<header> + title + search input + mode 切换 + / 快捷键 +
//   共有按钮 onAdd/onGraph/onSettings）下沉到 BaseTopBar
// - 领域按钮（book-tracker 的「排 / 待选」vs life-tracker 的「回收站 / 分析」）
//   通过 children 注入，rendered 在 mode toggle 左侧
// - add button 的文案 / tooltip 是 prop（"添加" / "加目标" 等）
// - mode toggle 文案（"日常模式" / "编辑模式"）固定不变 —— 两 app 概念一致
// - search placeholder 是 prop（"搜索作品名 / 作者" / "搜索目标 / 分类"）
//
// 后续若新增共有按钮（如"图分析"两 app 都要），加 BaseTopBar prop 即可。
// 若新增领域专属按钮，app 端加 children 即可。
//
// 不耦合任何 store —— mode + search 通过 props 传入（这样 vitest + jsdom 不需要
// mock zustand，组件纯函数化）。

import { useEffect, useRef, type ReactNode } from 'react'

export type Mode = 'clean' | 'edit'

export interface BaseTopBarProps {
  /** 顶部左侧 h1 文案（"作品追踪" / "目标追踪" 等） */
  title: string
  /** 搜索 input placeholder（"搜索作品名 / 作者 (按 / 聚焦)" 等） */
  searchPlaceholder: string
  /** 搜索 query 值（外部 store 控制） */
  searchQuery: string
  onSearchQueryChange: (q: string) => void

  /** 当前模式 */
  mode: Mode
  onModeChange: (mode: Mode) => void

  /** 添加按钮文案（"+ 添加" / "+ 加目标" 等） */
  addButtonLabel: string
  /** 添加按钮 tooltip（"加作品 / 系列 (n)" / "加目标 (n)" 等） */
  addButtonTitle: string
  onAdd?: () => void

  /** 共有右侧按钮 */
  onSettings?: () => void
  onGraph?: () => void

  /**
   * 领域专属按钮 slot —— rendered 在「设置」按钮**之前**（让领域按钮视觉上靠右
   * 但在通用控件左侧，跟原 book-tracker TopBar 行为一致）。可为空。
   *
   * 想要在「设置」之后插入额外按钮? 用多个 children + key 即可。
   */
  children?: ReactNode
}

export function BaseTopBar({
  title,
  searchPlaceholder,
  searchQuery,
  onSearchQueryChange,
  mode,
  onModeChange,
  addButtonLabel,
  addButtonTitle,
  onAdd,
  onSettings,
  onGraph,
  children
}: BaseTopBarProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  // '/' 快捷键聚焦搜索 —— 两 app 都有,下沉到 BaseTopBar
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
        <h1 className="app-title">{title}</h1>
      </div>
      <div className="topbar-center">
        <input
          ref={inputRef}
          type="search"
          placeholder={searchPlaceholder}
          className="search-input"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onSearchQueryChange('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      <div className="topbar-right">
        {onSettings && (
          <button className="topbar-icon-btn" onClick={onSettings} title="设置">
            设置
          </button>
        )}
        {children}
        {onGraph && (
          <button className="topbar-icon-btn" onClick={onGraph} title="关系图 (g)">
            图
          </button>
        )}
        <div className="mode-toggle" role="tablist" aria-label="模式">
          <button
            role="tab"
            aria-selected={mode === 'clean'}
            className={mode === 'clean' ? 'active' : ''}
            onClick={() => onModeChange('clean')}
          >
            日常模式
          </button>
          <button
            role="tab"
            aria-selected={mode === 'edit'}
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => onModeChange('edit')}
          >
            编辑模式
          </button>
        </div>
        <button className="add-btn" onClick={onAdd} title={addButtonTitle}>
          {addButtonLabel}
        </button>
      </div>
    </header>
  )
}
