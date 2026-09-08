// 集笔记便签 —— 独立 Tauri 窗口版(v2.x 新增)
//
// 形态:在独立 OS 窗口中渲染(label='sticky',400x480,always_on_top)。
// 窗口本身由 OS 提供标题栏 + 拖拽 + 关闭按钮(decorations=true);
// 本组件**不**自己管位置(position: fixed 去掉,window 提供位置)。
//
// 内容:复用 StampList —— 直接从 useBooksStore 读 stamps,改走 setEpisodeStamps
// / setStamps(整体替换式 IPC,跟 EpisodesPanel / BookStampsPanel 同款)。
//
// 边界(v2.x 决策):
// - **不**替换 BookNotesModal:那是"完整聚合视图"(主笔记 + 集笔记 + 角色笔记),
//   便签是"轻量便签"伴生入口
// - 组件**不**持有 stamps 草稿:stamps 是 React props from store,改走 IPC;
//   v2.x 治本模式(notesDirty + lastSentRef)在 StampList 内部已具备,
//   本组件不重复造轮子
// - localStorage 持久化 selection(非 config.json —— 跟 theme/format 同款);
//   position 不再持久化(OS 窗口位置由 OS 管,跨重启由 Rust / OS 决定)
//
// 触发:见同文件 <StickyTrigger> 命名导出 —— 在 EpisodesPanel / BookStampsPanel
// 标题右侧放 14x14 黄色小圆点,点击调 `api.app.openStickyWindow()` 让 Rust
// 端创建 / 聚焦本窗口。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Book, TimeStamp } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useBooksStore } from '../store/books'
import { useEpisodeStickyStore } from '../store/episodeSticky'
import { StampList } from './EpisodesPanel.StampList'
import {
  WorkPickerPopover,
  EpisodePickerPopover
} from './EpisodeNotesSticky.Popovers'
import { api } from '../lib/api'

// =============================================================
// <StickyTrigger> —— 主 app 面板标题右侧的小圆点触发器
// =============================================================

interface StickyTriggerProps {
  book: Book
  kind: 'episode' | 'movie'
}

/**
 * 触发器:14x14 黄色小圆点(像便签纸贴在角落),点击打开独立 Tauri 窗口。
 *
 * v2.x 行为:
 * - 点击 → 调 `api.app.openStickyWindow()` 让 Rust 端创建 / 聚焦 sticky 窗口
 * - 自动选作品:首次打开 + 当前未选作品 → 顺手把当前作品选上,避免用户再点「《xx》」
 * - `is-open` 状态通过跨 localStorage 同步(sticky 窗口 mount 时写 open=true key,
 *   主 app 用 `storage` event 监听;sticky 窗口 unload 时写 open=false)
 *   —— 让 trigger 视觉反映当前 sticky 窗口开 / 关
 */
export function StickyTrigger({ book, kind }: StickyTriggerProps): JSX.Element {
  const open = useEpisodeStickyStore((s) => s.open)
  const setOpen = useEpisodeStickyStore((s) => s.setOpen)
  const selectBook = useEpisodeStickyStore((s) => s.selectBook)

  function handleClick(): void {
    // 首次打开 + 当前未选作品 → 顺手把当前作品选上
    const state = useEpisodeStickyStore.getState()
    if (!state.selectedBookId) {
      selectBook(book.id, kind)
    }
    // 乐观更新本地 store(让 trigger 立刻显示 is-open);Rust 端后续会创建窗口
    setOpen(true)
    void api.app.openStickyWindow().catch((e) => {
      console.error('open sticky window failed:', e)
      setOpen(false)
    })
  }

  return (
    <button
      type="button"
      className={`sticky-trigger${open ? ' is-open' : ''}`}
      onClick={handleClick}
      title="集笔记便签 —— 打开独立窗口快速记时间戳"
      aria-label="打开集笔记便签独立窗口"
      aria-pressed={open}
      data-testid="sticky-trigger"
    />
  )
}

// =============================================================
// <EpisodeNotesSticky> —— 独立窗口的主组件
// =============================================================

/**
 * 便签窗口内容 —— 渲染在 Tauri sticky 窗口内,**填满整个窗口内容区**
 * (操作系统标题栏之下)。
 *
 * 跟 v1(主 app 内的浮层)的关键区别:
 * - 不再 position: fixed(由 OS 窗口提供位置)
 * - 不再有 mousedown 拖拽手柄(由 OS 标题栏提供)
 * - 永远不挂载条件(if open)—— sticky 窗口打开 = 组件挂载
 * - × 按钮 = `getCurrentWindow().hide()`(隐藏窗口,触发器可重新聚焦);
 *   OS 标题栏的 × 按钮 = 销毁窗口(Rust 默认行为)
 */
export function EpisodeNotesSticky(): JSX.Element {
  const selectedBookId = useEpisodeStickyStore((s) => s.selectedBookId)
  const selectedKind = useEpisodeStickyStore((s) => s.selectedKind)
  const selectedSeason = useEpisodeStickyStore((s) => s.selectedSeason)
  const selectedEpisode = useEpisodeStickyStore((s) => s.selectedEpisode)
  const clearSelection = useEpisodeStickyStore((s) => s.clearSelection)
  const hydrate = useEpisodeStickyStore((s) => s.hydrate)
  const setOpen = useEpisodeStickyStore((s) => s.setOpen)

  const allBooks = useBooksStore((s) => s.books)
  const setEpisodeStamps = useBooksStore((s) => s.setEpisodeStamps)
  const setStamps = useBooksStore((s) => s.setStamps)

  // hydrate 一次(从 localStorage 恢复 selection;position 不再持久化)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  // 注:sticky 窗口 mount/unmount 时**不**写 localStorage('tracker-episode-sticky-window-open'
  // 这类 key)—— v2.x 简化:**trigger 的 is-open 视觉只反映本地 store.open 状态**,
  // 不做跨窗口 storage event 同步(增加复杂度但收益小)。Rust 端已经处理
  // 「窗口已存在 → 聚焦」幂等,用户多次点 trigger 不会创建多个窗口。
  // 未来如果需要更精细的视觉反馈(如「窗口已被 OS X 关闭但 store 还以为开」)
  // 再补 Tauri 事件监听。

  // 当前选中的 book
  const book = useMemo(
    () => (selectedBookId ? allBooks.find((b) => b.id === selectedBookId) ?? null : null),
    [allBooks, selectedBookId]
  )

  // 当前 stamp list 来自哪个路径 —— **永远返回数组**(即使 episode record 不存在
  // 也返回 []),这样 StampList 始终能渲染 + 暴露添加区,允许用户给"还没记录的集"
  // 添加第一条 stamp。首次添加会触发 setEpisodeStamps → Rust 端自动创建 episode record。
  const stamps: TimeStamp[] = useMemo(() => {
    if (!book) return []
    if (selectedKind === 'movie') return book.stamps ?? []
    if (selectedKind === 'episode') {
      const key = `${selectedSeason}-${selectedEpisode}`
      return book.episodes?.[key]?.stamps ?? []
    }
    return []
  }, [book, selectedKind, selectedSeason, selectedEpisode])

  // popover 状态
  const [workPickerOpen, setWorkPickerOpen] = useState(false)
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false)
  const workPickerRef = useRef<HTMLDivElement | null>(null)
  const episodePickerRef = useRef<HTMLDivElement | null>(null)

  // 点浮窗外关闭 popover
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

  // Esc 关闭浮层 popover(editable 内 Esc 不抢,跟 Modal 同款)
  useEffect(() => {
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
      // 优先关 popover
      if (workPickerOpen || episodePickerOpen) {
        setWorkPickerOpen(false)
        setEpisodePickerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workPickerOpen, episodePickerOpen])

  // 当前 book 的季结构(用于 EpisodePickerPopover)
  const seasons = book?.seasons ?? []

  // × 按钮 = 隐藏窗口(可由 trigger 重新打开);同步本地 store.open
  async function handleHide(): Promise<void> {
    setOpen(false)
    try {
      await getCurrentWindow().hide()
    } catch (e) {
      console.error('hide sticky window failed:', e)
    }
  }

  return (
    <div
      className="episode-sticky-card"
      role="dialog"
      aria-label="集笔记便签"
      data-testid="episode-sticky-window"
    >
      <div className="sticky-header" data-testid="sticky-header">
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
        {/* 隐藏(OS 标题栏 × 按钮 = 销毁窗口;我们这里只隐藏,允许 trigger 重新聚焦) */}
        <button
          type="button"
          className="sticky-close-btn"
          onClick={() => handleHide()}
          aria-label="隐藏便签窗口"
          title="隐藏窗口(可在主 app 再次点击小圆点唤回)"
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