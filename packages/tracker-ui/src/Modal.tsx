// packages/tracker-ui/src/Modal.tsx
//
// 通用 Modal —— 两 app 各有一份(都是 53 行,字节级一致),抽到共享基座。
// 行为不变:Esc 关闭、点 backdrop 关闭、内部点击不冒泡、footer slot、width prop。

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
      if (e.key === 'Escape') onClose()
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
