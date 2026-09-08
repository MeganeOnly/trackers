// 集笔记便签浮窗 —— 顶部两个内嵌 popover(WorkPicker + EpisodePicker)
//
// 从 EpisodeNotesSticky.tsx 拆出(响应 DSH 插件 700 行/30KB 阈值;同时遵循
// 提前拆 Popovers 避免主文件膨胀 —— 跟 EpisodesPanel.tsx 拆 StampList 同款精神)。
//
// 设计要点:
// - **不是 Modal,是 popover**(AGENTS §十.40 反模式):position: absolute
//   浮在 trigger 下方,父浮窗相对定位;不嵌 backdrop 不抢 Esc(浮窗自己处理)
// - 复用 SeriesPickerModal 的「搜索 + 列表」模式但**不带新建**入口(避免嵌 AddModal);
//   用户选不到合适作品时关掉浮窗 → BookDetail 顶部加作品即可
// - 浮窗外点击 / Esc 关闭 —— 各自挂 mousedown / keydown 监听;
//   用 ref + contain 判断「是否点中 popover 自身」决定是否关闭

import { useEffect, useRef, useState } from 'react'
import type { Book, SeasonInfo } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { useBooksStore } from '../store/books'
import { useEpisodeStickyStore } from '../store/episodeSticky'

interface WorkPickerPopoverProps {
  /** 当前选中的作品 id(高亮) */
  currentBookId: string | null
  /** popover 自身的 DOM ref(父组件传入,用于 contain 判断) */
  popoverRef: React.RefObject<HTMLDivElement>
  /** 关闭回调 —— 由父组件统一管(浮窗 × / Esc / 点空白) */
  onClose: () => void
}

/**
 * 作品 picker —— 列出所有 `tv / anime / movie`(时间戳笔记支持的类型),
 * 按 title localeCompare(zh) 排序。点选 → store.selectBook(id, kind)。
 *
 * 注意:**不**做"新建作品"入口。理由:
 * - 浮窗心智是"快速记笔记",新建作品是低频操作,嵌进来违反浮窗轻量定位
 * - 嵌 AddModal 会触发 Modal-in-Modal(AGENTS §十.40 反模式)
 * - 用户选不到合适作品 → 关掉浮窗 → 在 BookDetail 顶部 "+ 添加" 即可
 */
export function WorkPickerPopover({
  currentBookId,
  popoverRef,
  onClose
}: WorkPickerPopoverProps): JSX.Element {
  const allBooks = useBooksStore((s) => s.books)
  const selectBook = useEpisodeStickyStore((s) => s.selectBook)

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开时聚焦搜索框
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Esc 关闭(让给浮窗自己的 Esc 之前先在 popover 内生效)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const candidates = allBooks
    .filter((b) => b.kind === 'tv' || b.kind === 'anime' || b.kind === 'movie')
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))

  const q = query.trim().toLowerCase()
  const filtered = q
    ? candidates.filter((b) => b.title.toLowerCase().includes(q))
    : candidates

  return (
    <div ref={popoverRef} className="sticky-popover sticky-work-picker" role="dialog" aria-label="选择作品">
      <input
        ref={inputRef}
        className="sticky-popover-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索作品名..."
      />
      <ul className="sticky-popover-list">
        {filtered.length === 0 ? (
          <li className="muted sticky-popover-empty">无匹配作品</li>
        ) : (
          filtered.map((b) => (
            <li
              key={b.id}
              className={`sticky-popover-item${b.id === currentBookId ? ' is-selected' : ''}`}
              onClick={() => {
                const kind = b.kind === 'movie' ? 'movie' : 'episode'
                selectBook(b.id, kind)
                onClose()
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  const kind = b.kind === 'movie' ? 'movie' : 'episode'
                  selectBook(b.id, kind)
                  onClose()
                }
              }}
            >
              <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
              <span className="sticky-popover-item-title">{b.title}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

// =============================================================
// EpisodePickerPopover
// =============================================================

interface EpisodePickerPopoverProps {
  book: Book
  seasons: SeasonInfo[]
  currentSeason: number
  currentEpisode: number
  popoverRef: React.RefObject<HTMLDivElement>
  onClose: () => void
}

/**
 * 集数 picker —— 按季分组,每季内显示该季集数(只显示 ≤ episodeCount,
 * **不**鼓励"超出 episodeCount 创建隐式集" —— 用户想记"特殊番外"
 * 走 BookDetail 调整 episodeCount;便签不引入隐式数据)。
 *
 * 当前选中集高亮;点击切到该集 → store.selectEpisode。
 */
export function EpisodePickerPopover({
  book,
  seasons,
  currentSeason,
  currentEpisode,
  popoverRef,
  onClose
}: EpisodePickerPopoverProps): JSX.Element {
  const selectEpisode = useEpisodeStickyStore((s) => s.selectEpisode)

  // 打开时聚焦 popover 自身(让后续 ↑↓ 导航可用 —— 此版暂不实现键盘导航,聚焦即可)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    requestAnimationFrame(() => rootRef.current?.focus())
  }, [])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 把 ref 合并到外部传入的 popoverRef
  function setMergedRef(el: HTMLDivElement | null): void {
    rootRef.current = el
    popoverRef.current = el
  }

  return (
    <div
      ref={setMergedRef}
      className="sticky-popover sticky-episode-picker"
      role="dialog"
      aria-label="选择集数"
      tabIndex={-1}
    >
      {seasons.length === 0 ? (
        <p className="muted sticky-popover-empty">该作品暂无季结构 —— 在 BookDetail 加季后才能选集</p>
      ) : (
        seasons.map((s) => (
          <div key={s.number} className="sticky-episode-season">
            <div className="sticky-episode-season-head">S{String(s.number).padStart(2, '0')} · {s.episodeCount} 集</div>
            <div className="sticky-episode-grid">
              {Array.from({ length: s.episodeCount }, (_, i) => i + 1).map((ep) => {
                const isCurrent = s.number === currentSeason && ep === currentEpisode
                return (
                  <button
                    key={ep}
                    type="button"
                    className={`sticky-episode-cell${isCurrent ? ' is-current' : ''}`}
                    onClick={() => {
                      selectEpisode(s.number, ep)
                      onClose()
                    }}
                  >
                    {ep}
                  </button>
                )
              })}
            </div>
          </div>
        ))
      )}
      {/* 让消费者知道是哪个 book(测试断言用;UI 上不明显) */}
      <span style={{ display: 'none' }} data-testid="episode-picker-book">{book.title}</span>
    </div>
  )
}