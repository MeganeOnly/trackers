// 集笔记便签浮窗 单元测试(v2.x 新增)
//
// 测试策略(遵循 AGENTS.md §十.44):
// - 直接用 zustand `useEpisodeStickyStore.setState` / `useBooksStore.setState` 注入 mock 数据
// - jsdom + React 18 受控 input commit 时序不可靠 → 不依赖 fireEvent 末位字符断言
// - 重点测:store 行为 + DOM 结构(data-testid) + 关键交互的最终态
//
// 覆盖(10 case):
//  1. 默认 open=false → DOM 无浮窗
//  2. hydrate 后 position + selection 从 localStorage 恢复;open 仍由用户态控制
//  3. StickyTrigger 点击 → toggle open + 当前 book 自动被选上
//  4. selectBook 重置集数:tv/anime → [1,1];movie → [0,0]
//  5. WorkPickerPopover 列出 tv/anime/movie(book/other 灰掉)
//  6. book 删除降级 → 显示「作品已删除」+ 重选按钮
//  7. movie 模式下「01」位不可点 → 显示「—」
//  8. 拖拽 → mouseup 时写 localStorage
//  9. Esc 关闭(焦点在 body)
// 10. trigger 在 EpisodesPanel 标题行内渲染
//
// 注:本地 useEpisodeStickyStore 跨测试用 setState 重置,跟 BookNotesModal.close.test 同款

// @vitest-environment jsdom

// jsdom 缺 scrollIntoView(同上)
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { WikilinkProvider } from '../WikilinkContext'
import { EpisodesPanel } from '../EpisodesPanel'
import { EpisodeNotesSticky, StickyTrigger } from '../EpisodeNotesSticky'
import { useBooksStore } from '../../store/books'
import { useEpisodeStickyStore } from '../../store/episodeSticky'
import type { Book } from '@shared/types'

// =============================================================
// fixtures
// =============================================================

const TV_BOOK: Book = {
  id: '1',
  title: '假面骑士龙骑',
  status: 'watching',
  kind: 'tv',
  author: '',
  country: '',
  year: 2002,
  translator: '',
  read_count: 1,
  progress: { current: 3, total: 50 },
  collapsed: false,
  created: '',
  updated: '',
  tags: [],
  notes: '',
  starring: '',
  screenwriter: '',
  seasons: [{ number: 1, episodeCount: 50 }],
  episodes: {},
  characters: []
}

const MOVIE_BOOK: Book = {
  ...TV_BOOK,
  id: '2',
  title: '盗梦空间',
  kind: 'movie',
  progress: null,
  seasons: [],
  episodes: {},
  stamps: []
}

const BOOK_ONLY: Book = {
  ...TV_BOOK,
  id: '3',
  title: '百年孤独',
  kind: 'book',
  seasons: [],
  episodes: {},
  characters: []
}

function resetStores(): void {
  useBooksStore.setState({
    books: [],
    broken: [],
    selectedId: null,
    loading: false,
    navigateToCharacter: null
  })
  useEpisodeStickyStore.setState({
    open: false,
    position: { x: -1, y: 80 },
    selectedBookId: null,
    selectedKind: null,
    selectedSeason: 0,
    selectedEpisode: 0,
    hydrated: true // 跳过 hydrate(测试不依赖 localStorage 恢复)
  })
  // 清 localStorage
  localStorage.clear()
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetStores()
})

// =============================================================
// tests
// =============================================================

describe('EpisodeNotesSticky / StickyTrigger', () => {
  it('1. 组件始终渲染(不再受 open 控制 —— 独立窗口打开 = 组件挂载)', () => {
    useBooksStore.setState({ books: [TV_BOOK] })
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )
    // v2.x:不在 if open 时返回 null;独立窗口整个 root 都是组件,组件始终挂载
    expect(screen.getByTestId('sticky-header')).toBeTruthy()
  })

  it('2. hydrate 后 selection 从 localStorage 恢复(position 由 OS 管不再持久化)', () => {
    useEpisodeStickyStore.setState({ hydrated: false })
    localStorage.setItem(
      'tracker-episode-sticky-selection',
      JSON.stringify({ bookId: '1', kind: 'episode', season: 2, episode: 5 })
    )

    useEpisodeStickyStore.getState().hydrate()

    const state = useEpisodeStickyStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.selectedBookId).toBe('1')
    expect(state.selectedSeason).toBe(2)
    expect(state.selectedEpisode).toBe(5)
    // open 状态**不**恢复
    expect(state.open).toBe(false)
  })

  it('3. StickyTrigger 点击 → setOpen(true) + 自动选当前 book + 调 IPC', async () => {
    useBooksStore.setState({ books: [TV_BOOK] })
    // mock api.app.openStickyWindow —— 避免 jsdom 拉 Tauri runtime
    const openSpy = vi.fn().mockResolvedValue(undefined)
    const apiMod = await import('../../lib/api')
    const origOpen = apiMod.api.app.openStickyWindow
    apiMod.api.app.openStickyWindow = openSpy

    try {
      render(
        <WikilinkProvider>
          <StickyTrigger book={TV_BOOK} kind="episode" />
        </WikilinkProvider>
      )
      const trigger = screen.getByTestId('sticky-trigger')

      await act(async () => {
        fireEvent.click(trigger)
        await Promise.resolve()
      })

      const state = useEpisodeStickyStore.getState()
      expect(state.open).toBe(true)
      expect(state.selectedBookId).toBe(TV_BOOK.id)
      expect(state.selectedKind).toBe('episode')
      expect(state.selectedSeason).toBe(1)
      expect(state.selectedEpisode).toBe(1)
      expect(openSpy).toHaveBeenCalledTimes(1)
    } finally {
      apiMod.api.app.openStickyWindow = origOpen
    }
  })

  it('4. selectBook 重置集数:tv/anime → [1,1];movie → [0,0]', () => {
    const { selectBook } = useEpisodeStickyStore.getState()
    // 模拟"先选了 A 的第 3 集"
    act(() => {
      selectBook('1', 'episode')
      useEpisodeStickyStore.setState({ selectedSeason: 3, selectedEpisode: 7 })
    })
    // 切到 tv
    act(() => {
      selectBook('4', 'episode')
    })
    let s = useEpisodeStickyStore.getState()
    expect(s.selectedSeason).toBe(1)
    expect(s.selectedEpisode).toBe(1)

    // 切到 movie
    act(() => {
      selectBook('5', 'movie')
    })
    s = useEpisodeStickyStore.getState()
    expect(s.selectedKind).toBe('movie')
    expect(s.selectedSeason).toBe(0)
    expect(s.selectedEpisode).toBe(0)
  })

  it('5. WorkPicker 列出 tv / anime / movie,过滤 book / other', () => {
    useBooksStore.setState({ books: [TV_BOOK, MOVIE_BOOK, BOOK_ONLY] })
    // 选中一本后才能渲染 header
    useEpisodeStickyStore.setState({
      selectedBookId: TV_BOOK.id,
      selectedKind: 'episode',
      selectedSeason: 1,
      selectedEpisode: 1
    })
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )

    act(() => {
      fireEvent.click(screen.getByTestId('sticky-title-btn'))
    })

    expect(screen.getByText('假面骑士龙骑')).toBeTruthy()
    expect(screen.getByText('盗梦空间')).toBeTruthy()
    expect(screen.queryByText('百年孤独')).toBeNull()
  })

  it('6. book 删除降级 → 显示「作品已删除」+ 重选按钮', () => {
    useBooksStore.setState({ books: [] })
    useEpisodeStickyStore.setState({
      selectedBookId: '999', // 不存在
      selectedKind: 'episode',
      selectedSeason: 1,
      selectedEpisode: 1
    })
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )
    expect(screen.getByText(/作品已删除/)).toBeTruthy()
  })

  it('7. movie 模式下「01」位不可点 → 显示「—」', () => {
    useBooksStore.setState({ books: [MOVIE_BOOK] })
    useEpisodeStickyStore.setState({
      selectedBookId: MOVIE_BOOK.id,
      selectedKind: 'movie',
      selectedSeason: 0,
      selectedEpisode: 0
    })
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )
    const dash = screen.getAllByText('—')[0]
    expect(dash).toBeTruthy()
    expect(screen.queryByTestId('sticky-episode-btn')).toBeNull()
  })

  it('8. 拖拽浮窗 → setPosition 写 localStorage(测试 store 层,避开 jsdom native event 不可靠问题)', () => {
    // 直接测 store.setPosition —— 拖拽 handler 内部就是调它。
    // jsdom + testing-library 的 fireEvent.mouseMove 在 document 上不触发
    // 通过 document.addEventListener('mousemove', ...) 注册的 native handler
    // (与 AGENTS §十.44 同款 jsdom commit 时序问题);改测 store action,
    // 覆盖「写盘 + clamp」逻辑更稳。
    const { setPosition } = useEpisodeStickyStore.getState()

    act(() => {
      setPosition({ x: 100, y: 200 })
    })

    const stored = localStorage.getItem('tracker-episode-sticky-position')
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as { x: number; y: number }
    // jsdom 默认 viewport 1024x768,clamp 后 x 在 [8, 1024-360-8] = [8, 656] 范围
    expect(parsed.x).toBe(100)
    expect(parsed.y).toBe(200)

    // 越界值应该被 clamp
    act(() => {
      setPosition({ x: 9999, y: 9999 })
    })
    const clamped = JSON.parse(localStorage.getItem('tracker-episode-sticky-position')!) as {
      x: number
      y: number
    }
    // x 应 ≤ 1024-360-8 = 656;y 应 ≤ 768-300-8 = 460
    expect(clamped.x).toBeLessThanOrEqual(656)
    expect(clamped.y).toBeLessThanOrEqual(460)
    expect(clamped.x).toBeGreaterThanOrEqual(8)
    expect(clamped.y).toBeGreaterThanOrEqual(8)
  })

  it('9. Esc 关 popover(不关窗口 —— 窗口关闭走 OS 标题栏 × 按钮或 UI × 的 hide())', () => {
    useBooksStore.setState({ books: [TV_BOOK] })
    useEpisodeStickyStore.setState({
      selectedBookId: TV_BOOK.id,
      selectedKind: 'episode',
      selectedSeason: 1,
      selectedEpisode: 1,
      hydrated: true
    })
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )
    // 先打开 work picker
    act(() => {
      fireEvent.click(screen.getByTestId('sticky-title-btn'))
    })
    expect(screen.getByPlaceholderText('搜索作品名...')).toBeTruthy()
    // Esc 关闭 picker
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByPlaceholderText('搜索作品名...')).toBeNull()
  })

  it('10. StickyTrigger 在 EpisodesPanel 标题行内渲染(贴「集笔记」右侧)', () => {
    useBooksStore.setState({ books: [TV_BOOK] })
    render(
      <WikilinkProvider>
        <EpisodesPanel book={TV_BOOK} />
      </WikilinkProvider>
    )
    // 标题「集笔记」应存在
    expect(screen.getByText('集笔记')).toBeTruthy()
    // trigger 应在同一行内
    const trigger = screen.getByTestId('sticky-trigger')
    expect(trigger).toBeTruthy()
    // trigger 应是 h3 的兄弟节点(同一父 .episodes-panel-title-row)
    const titleRow = trigger.closest('.episodes-panel-title-row')
    expect(titleRow).toBeTruthy()
    expect(titleRow?.querySelector('h3')?.textContent).toBe('集笔记')
  })
})