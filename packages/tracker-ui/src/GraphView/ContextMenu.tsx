// packages/tracker-ui/src/GraphView/ContextMenu.tsx
//
// 关系图右键菜单 —— 浮在点击位置，点击外部 / Esc / 滚轮 / 选中项后关闭。
//
// 共享层只管视觉 + 关闭逻辑；菜单项由 app 端生成（contextMenuItems callback）。
// 坐标用 clientX / clientY 直接绝对定位；菜单超出屏幕时 clamp 到边缘。

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  /** 内联 SVG / 字符（不含 emoji，遵循 personal-preferences） */
  icon?: ReactNode
  /** danger 项用红字 + hover 红底 */
  danger?: boolean
  /** 不可选（disabled）—— 用于「无前置时无法解除前置」等场景 */
  disabled?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const MENU_MAX_W = 220

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)

  // Esc / 滚轮关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onWheel = (): void => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [onClose])

  // 屏幕边缘 clamp（菜单宽 ~200px，高 ~items.length * 30px）
  const menuW = MENU_MAX_W
  const menuH = items.length * 32 + 12
  const left = Math.min(x, window.innerWidth - menuW - 8)
  const top = Math.min(y, window.innerHeight - menuH - 8)

  return (
    <>
      {/* 全屏透明 backdrop 抢点击 → 关闭菜单 */}
      <div className="context-menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={wrapRef}
        className="context-menu"
        style={{ left, top, minWidth: menuW }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={
              'context-menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '')
            }
            onClick={() => {
              if (it.disabled) return
              it.onSelect()
              onClose()
            }}
          >
            {it.icon && <span className="context-menu-icon">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}