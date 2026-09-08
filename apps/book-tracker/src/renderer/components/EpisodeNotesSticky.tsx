// 集笔记便签浮窗 —— 便签条风格的轻量时间戳入口(v2.x 新增)
//
// 触发:见同文件 <StickyTrigger> 命名导出;EpisodesPanel / BookStampsPanel
// 标题右侧放一个 14x14 黄色小圆点,点击 toggle 浮窗。
//
// 形态:position: fixed 的小浮窗(360x自适应高,最大 70vh),无 backdrop,
// 可拖拽(mousedown 在 header 空白处),便签条观感。
//
// 内容:复用 StampList —— 直接从 useBooksStore 读 stamps,改走 setEpisodeStamps
// / setStamps(整体替换式 IPC,跟 EpisodesPanel / BookStampsPanel 同款)。
//
// 边界(v2.x 决策):
// - **不**替换 BookNotesModal:那是"完整聚合视图"(主笔记 + 集笔记 + 角色笔记),
//   浮窗是"轻量便签"伴生入口
// - 浮窗**不**持有 stamps 草稿:stamps 是 React props from store,改走 IPC;
//   v2.x 治本模式(notesDirty + lastSentRef)在 StampList 内部已具备,
//   本组件不重复造轮子
// - 拖拽用原生 mousedown,不引入 react-draggable(AGENTS §二"刻意保持小")
// - localStorage 持久化 position + selection(非 config.json —— 跟 theme/format 同款)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book, TimeStamp } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { useBooksStore } from '../store/books'
import { useEpisodeStickyStore } from '../store/episodeSticky'
import { StampList } from './EpisodesPanel.StampList'
import {
  WorkPickerPopover,
  EpisodePickerPopover
} from './EpisodeNotesSticky.Popovers'

// =============================================================
// <StickyTrigger> —— 标题右侧的小圆点触发器
// =============================================================

interface StickyTriggerProps {
  book: Book
  kind: 'episode' | 'movie'
}

/**
 * 触发器:14x14 黄色小圆点(像便签纸贴在角落),点击 toggle 浮窗。
 *
 * - 首次点击时**自动选当前作品 + 默认季/集**(避免用户还要再选一次)
 * - 再次点击 = 关闭浮窗(toggle 语义)
 * - 浮窗打开时小圆点变 active 态(略放大 + accent 描边),用户知道"再点会关"
 *
 * 位置:在 EpisodesPanel 的「集笔记」h3 右侧 / BookStampsPanel 的「时间戳笔记」右侧;
 * 由父组件决定布局(本组件是单个按钮,不带外壳)。
 */
export function StickyTrigger({ book, kind }: StickyTriggerProps): JSX.Element {
  const open = useEpisodeStickyStore((s) => s.open)
  const toggle = useEpisodeStickyStore((s) => s.toggle)
  const selectBook = useEpisodeStickyStore((s) => s.selectBook)
  // 触发器跟浮窗同源 —— 用 ref 标记"点击来自 trigger"以便 focus 回到 trigger
  const focusReturnRef = useStickyTriggerFocusReturn()

  function handleClick(): void {
    // 首次打开 + 当前未选作品 → 顺手把当前作品选上(避免用户还要再点一次「《xx》」)
    const state = useEpisodeStickyStore.getState()
    if (!state.open && !state.selectedBookId) {
      selectBook(book.id, kind)
    }
    // 标记"点击来源"以便关闭后 focus 回到这里
    focusReturnRef.current = document.activeElement as HTMLElement | null
    toggle()
  }

  return (
    <button
      type="button"
      className={`sticky-trigger${open ? ' is-open' : ''}`}
      onClick={handleClick}
      title="集笔记便签 —— 打开浮窗快速记时间戳"
      aria-label="打开集笔记便签浮窗"
      aria-pressed={open}
      data-testid="sticky-trigger"
    />
  )
}

/**
 * 共享"关闭浮窗后焦点回到哪"的引用 —— 避免 trigger 按钮 ref 在浮窗内部维护。
 * 用 module-scope 弱引用(简单且够用:同一时刻只有一个 trigger 来源 + 一个浮窗)。
 */
const focusReturnRef = { current: null as HTMLElement | null }
function useStickyTriggerFocusReturn(): typeof focusReturnRef {
  return focusReturnRef
}

// =============================================================
// <EpisodeNotesSticky> —— 浮窗主组件
// =============================================================

/**
 * 浮窗主组件 —— 始终挂载在 App 树根,根据 store.open 决定显示/隐藏。
 *
 * 渲染策略:
 * - 始终挂载(不卸载)—— 避免每次 toggle 重新 hydrate 位置/选中状态
 * - 用 `style={{ display: open ? 'block' : 'none' }}` 或 `hidden` 属性切换
 * - 不挂时 events 全停(Event handler 仍存在但无 DOM 交互)
 *
 * 浮窗内子组件:
 * - header:拖拽手柄 + 作品标题(可点)+ 集数(可点,movie 不可点)+ × 关闭
 * - popover 区:点击《xx》/「01」浮出 picker
 * - body:StampList(直接复用 EpisodesPanel.StampList)
 */
export function EpisodeNotesSticky(): JSX.Element | null {
  const open = useEpisodeStickyStore((s) => s.open)
  const position = useEpisodeStickyStore((s) => s.position)
  const setPosition = useEpisodeStickyStore((s) => s.setPosition)
  const setOpen = useEpisodeStickyStore((s) => s.setOpen)
  const selectedBookId = useEpisodeStickyStore((s) => s.selectedBookId)
  const selectedKind = useEpisodeStickyStore((s) => s.selectedKind)
  const selectedSeason = useEpisodeStickyStore((s) => s.selectedSeason)
  const selectedEpisode = useEpisodeStickyStore((s) => s.selectedEpisode)
  const clearSelection = useEpisodeStickyStore((s) => s.clearSelection)
  const hydrate = useEpisodeStickyStore((s) => s.hydrate)

  const allBooks = useBooksStore((s) => s.books)
  const setEpisodeStamps = useBooksStore((s) => s.setEpisodeStamps)
  const setStamps = useBooksStore((s) => s.setStamps)

  // hydrate 一次(从 localStorage 恢复 position + selection)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // 当前选中的 book
  const book = useMemo(
    () => (selectedBookId ? allBooks.find((b) => b.id === selectedBookId) ?? null : null),
    [allBooks, selectedBookId]
  )

  // 当前 stamp list 来自哪个路径 —— **永远返回数组**(即使 episode record 不存在
  // 也返回 []),这样 StampList 始终能渲染 + 暴露添加区,允许用户给"还没记录的集"
  // 添加第一条 stamp。首次添加会触发 setEpisodeStamps → Rust 端自动创建 episode record
  // (v1.5 sparse 策略 + per-stamp lastModified 写盘逻辑已覆盖空 record 场景)。
  const stamps: TimeStamp[] = useMemo(() => {
    if (!book) return []
    if (selectedKind === 'movie') return book.stamps ?? []
    if (selectedKind === 'episode') {
      const key = `${selectedSeason}-${selectedEpisode}`
      return book.episodes?.[key]?.stamps ?? []
    }
    return []
  }, [book, selectedKind, selectedSeason, selectedEpisode])

  // ---------- 拖拽 ----------
  const cardRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  // 拖拽期间不响应 click(避免松手时误触 header 上的按钮 / popover trigger)
  const didDragRef = useRef(false)

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLElement>): void => {
    // 只响应左键
    if (e.button !== 0) return
    // 跳过可点击子元素(让它们的 click 行为不受拖拽影响)
    const target = e.target as HTMLElement
    if (target.closest('.sticky-trigger-ignore')) return
    // 不响应 input / select / textarea / contenteditable
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) return

    const card = cardRef.current
    if (!card) return

    const rect = card.getBoundingClientRect()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top
    }
    didDragRef.current = false
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'

    function onMove(ev: MouseEvent): void {
      const d = dragRef.current
      if (!d) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      // 移动超过 3px 才算拖拽,避免误触
      if (!didDragRef.current && Math.abs(dx) + Math.abs(dy) < 3) return
      didDragRef.current = true
      const next = { x: d.origX + dx, y: d.origY + dy }
      // 实时更新(不写 localStorage —— 拖拽过程中频繁写盘性能差,松手时统一写)
      // 但 clamp 在 store.setPosition 里已处理;为了实时跟随光标又不频繁写盘,
      // 这里直接修改 DOM style;松手时再 setPosition 触发 store + localStorage
      card.style.left = `${next.x}px`
      card.style.top = `${next.y}px`
    }
    function onUp(ev: MouseEvent): void {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      if (didDragRef.current) {
        const dx = ev.clientX - d.startX
        const dy = ev.clientY - d.startY
        // 松手 → setPosition(走 store + localStorage)
        setPosition({ x: d.origX + dx, y: d.origY + dy })
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [setPosition])

  // 关闭时焦点回到 trigger
  useEffect(() => {
    if (!open && focusReturnRef.current) {
      // 用 queueMicrotask 避免 React commit 期间同步 focus 触发 effect 循环
      queueMicrotask(() => {
        focusReturnRef.current?.focus()
        focusReturnRef.current = null
      })
    }
  }, [open])

  // Esc 关闭(editable 内 Esc 不抢,跟 Modal 同款)
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // popover 状态
  const [workPickerOpen, setWorkPickerOpen] = useState(false)
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false)
  const workPickerRef = useRef<HTMLDivElement | null>(null)
  const episodePickerRef = useRef<HTMLDivElement | null>(null)

  // 点浮窗外关闭 popover(浮窗内非 popover 区域 + 浮窗本身外)
  useEffect(() => {
    if (!workPickerOpen && !episodePickerOpen) return
    function onMouseDown(e: MouseEvent): void {
      const target = e.target as Node
      // 点击在 popover 内 → 不关
      if (workPickerOpen && workPickerRef.current?.contains(target)) return
      if (episodePickerOpen && episodePickerRef.current?.contains(target)) return
      // 点击在 popover trigger 按钮上 → 不关(由 trigger 自己 toggle)
      const t = target as HTMLElement
      if (t.closest('.sticky-popover-trigger')) return
      // 否则 → 关
      setWorkPickerOpen(false)
      setEpisodePickerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [workPickerOpen, episodePickerOpen])

  // ---------- render ----------
  if (!open) return null

  // 位置:首屏未 hydrate 完时给个 fallback(避免 x=-1 渲染)
  const posStyle: React.CSSProperties = position.x < 0
    ? { top: 80, right: 80 }
    : { left: position.x, top: position.y }

  // 当前 book 的季结构(用于 EpisodePickerPopover)
  const seasons = book?.seasons ?? []

  return (
    <div
      ref={cardRef}
      className="episode-sticky-card"
      style={posStyle}
      role="dialog"
      aria-label="集笔记便签"
    >
      <div
        className="sticky-header"
        onMouseDown={handleHeaderMouseDown}
        data-testid="sticky-header"
      >
        {/* 作品标题(可点击切换)—— movie 时也显示但 picker 内只列 movie 一类 */}
        <button
          type="button"
          className="sticky-title-btn sticky-popover-trigger"
          onClick={() => {
            setWorkPickerOpen((v) => !v)
            setEpisodePickerOpen(false)
          }}
          data-testid="sticky-title-btn"
        >
          {book ? (
            <>
              《{book.title}》
              <span className={`kind-tag kind-${book.kind}`}>{WORK_KIND_LABELS[book.kind]}</span>
            </>
          ) : (
            <span className="muted">选作品</span>
          )}
        </button>
        {/* 集数(可点击切换;movie 不可点) */}
        {selectedKind === 'movie' ? (
          <span className="sticky-episode-display muted" title="电影无集数">—</span>
        ) : (
          <button
            type="button"
            className="sticky-episode-btn sticky-popover-trigger"
            onClick={() => {
              if (!book) return
              setEpisodePickerOpen((v) => !v)
              setWorkPickerOpen(false)
            }}
            disabled={!book || seasons.length === 0}
            data-testid="sticky-episode-btn"
          >
            {String(selectedEpisode).padStart(2, '0')}
          </button>
        )}
        {/* 关闭 */}
        <button
          type="button"
          className="sticky-close-btn sticky-trigger-ignore"
          onClick={() => setOpen(false)}
          aria-label="关闭便签浮窗"
          data-testid="sticky-close"
        >
          ×
        </button>
      </div>

      {/* popover 层 */}
      {workPickerOpen && (
        <WorkPickerPopover
          currentBookId={selectedBookId}
          popoverRef={workPickerRef}
          onClose={() => setWorkPickerOpen(false)}
        />
      )}
      {episodePickerOpen && book && (
        <EpisodePickerPopover
          book={book}
          seasons={seasons}
          currentSeason={selectedSeason}
          currentEpisode={selectedEpisode}
          popoverRef={episodePickerRef}
          onClose={() => setEpisodePickerOpen(false)}
        />
      )}

      {/* 内容区 */}
      <div className="sticky-body">
        {book && (
          <StampList
            book={book}
            allBooks={allBooks}
            stamps={stamps}
            onChange={(next) => {
              // 整体替换式 IPC(StampList 已按 start 升序排好)
              if (selectedKind === 'movie') {
                void setStamps(book.id, next, undefined)
              } else {
                void setEpisodeStamps(book.id, selectedSeason, selectedEpisode, next, undefined)
              }
            }}
          />
        )}
        {!book && (
          <div className="sticky-no-book">
            <p className="muted">点击上方「选作品」开始</p>
            {selectedBookId !== null && (
              // book 被删了 → 提供「重选」按钮
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  clearSelection()
                  setWorkPickerOpen(true)
                }}
              >
                作品已删除 — 重选
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}