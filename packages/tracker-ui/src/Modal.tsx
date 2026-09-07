// packages/tracker-ui/src/Modal.tsx
//
// 通用 Modal —— 两 app 各有一份(都是 53 行,字节级一致),抽到共享基座。
// 行为不变:Esc 关闭、点 backdrop 关闭、内部点击不冒泡、footer slot、width prop。
//
// v2.x 修：Esc 关闭行为**区分焦点元素**(book-tracker §10.5):
// - 焦点在 INPUT / TEXTAREA / contenteditable 内 → 不主动关闭 modal，
//   Esc 留给元素自己处理(各 textarea/input 有自己的 Esc 处理,
//   如 BookNotesModal 主笔记 textarea 用 Esc 退出编辑态、NextSeasonPicker
//   用 Esc 关 picker、SeriesPickBooksBody 用 Esc 关 view 等)
// - 否则(焦点在 body / button / span 等) → 关闭 modal(原本行为)
// 治本理由：之前 BookNotesModal 的 textarea onKeyDown 只 preventDefault
// 没 stopPropagation，React SyntheticEvent 的 stopPropagation 不影响原生
// window listener,所以 Modal 的 window-level Esc listener 会一起触发,
// 用户按 Esc 期望"退出编辑"但实际"关闭整个 modal + 笔记内容丢失"。
// 现在 Modal 在 editable 内不再抢 Esc,textarea 自己的处理是唯一响应。

import { useEffect } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  /** 附加到 .modal-card 上的类名（如需要确定高度/特殊布局时用） */
  className?: string
  /** 附加到 .modal-backdrop 上的类名（如需要更高层级、叠在其它 modal 之上时用） */
  backdropClassName?: string
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 560,
  className,
  backdropClassName
}: ModalProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // 焦点在可编辑元素内 → 不主动关闭,Esc 留给元素自己处理
      // (textarea / input 都有自己的 Esc 处理:退出编辑态 / 清搜索 / 关 picker 等)
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}
      onClick={onClose}
    >
      <div
        className={`modal-card${className ? ` ${className}` : ''}`}
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}
