import { useCallback, useEffect, useRef, useState } from 'react'
import { BookList } from '../components/BookList'
import { BookDetail } from '../components/BookDetail'

/** localStorage 持久化键:编辑模式左栏宽度(px) */
const SIDEBAR_WIDTH_LS_KEY = 'book-tracker:edit:sidebar-width'

/** 左栏宽度边界,防拖到看不见/反客为主 */
const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 600
const SIDEBAR_WIDTH_DEFAULT = 280

function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_LS_KEY)
    if (!raw) return SIDEBAR_WIDTH_DEFAULT
    const n = Number(raw)
    if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT
    return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n))
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

function persistSidebarWidth(w: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_LS_KEY, String(w))
  } catch {
    /* 隐私模式 / quota 满 —— 不影响 in-memory */
  }
}

export function EditMode(): JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth)

  // 拖拽中临时持有「拖拽起始时的鼠标 X + 起始宽度」,避免每次 mousemove 都从当前 width 累加导致抖动
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)
  // 最新 width 的镜像 —— window 级 mousemove/mouseup 闭包通过 ref 读最新值,避免 stale closure
  const widthRef = useRef<number>(sidebarWidth)
  useEffect(() => { widthRef.current = sidebarWidth }, [sidebarWidth])

  const onResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: widthRef.current }
  }, [])

  useEffect(() => {
    function onMove(e: MouseEvent): void {
      const s = dragState.current
      if (!s) return
      const delta = e.clientX - s.startX
      const next = Math.min(
        SIDEBAR_WIDTH_MAX,
        Math.max(SIDEBAR_WIDTH_MIN, s.startWidth + delta)
      )
      setSidebarWidth(next)
    }
    function onUp(): void {
      if (!dragState.current) return
      dragState.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // drag 结束才写盘 —— mousemove 高频 setSidebarWidth 不触发持久化
      persistSidebarWidth(widthRef.current)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 拖拽中改 body 鼠标与文本选择(避免拖出 handle 时光标闪 + 误选中文本)
  useEffect(() => {
    if (dragState.current) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
  })

  return (
    <div
      className="page-edit"
      style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}
    >
      <aside className="sidebar">
        <BookList />
      </aside>
      <div
        className="sidebar-resizer"
        onMouseDown={onResizerMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整侧栏宽度"
        title="拖拽调整侧栏宽度"
      />
      <main className="detail-panel">
        <BookDetail />
      </main>
    </div>
  )
}
