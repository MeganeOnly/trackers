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
  it('1. 默认 open=false → DOM 中无浮窗卡片', () => {
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )
    // 浮窗挂载但 hidden(open=false 时返回 null)
    expect(screen.queryByTestId('sticky-header')).toBeNull()
  })

  it('2. hydrate 后 position + selection 从 localStorage 恢复', () => {
    // 预置 localStorage(注意:hydrate 会 mark hydrated=true,需先清掉)
    useEpisodeStickyStore.setState({ hydrated: false })
    localStorage.setItem('tracker-episode-sticky-position', JSON.stringify({ x: 100, y: 200 }))
    localStorage.setItem(
      'tracker-episode-sticky-selection',
      JSON.stringify({ bookId: '1', kind: 'episode', season: 2, episode: 5 })
    )

    useEpisodeStickyStore.getState().hydrate()

    const state = useEpisodeStickyStore.getState()
    expect(state.hydrated).toBe(true)
    expect(state.position).toEqual({ x: 100, y: 200 })
    expect(state.selectedBookId).toBe('1')
    expect(state.selectedSeason).toBe(2)
    expect(state.selectedEpisode).toBe(5)
    // open 状态**不**恢复
    expect(state.open).toBe(false)
  })

  it('3. StickyTrigger 点击 → toggle open + 自动选当前 book', () => {
    useBooksStore.setState({ books: [TV_BOOK] })
    render(
      <WikilinkProvider>
        <StickyTrigger book={TV_BOOK} kind="episode" />
      </WikilinkProvider>
    )
    const trigger = screen.getByTestId('sticky-trigger')

    // 第一次点击 → open=true + 自动选 TV_BOOK
    act(() => {
      fireEvent.click(trigger)
    })
    let state = useEpisodeStickyStore.getState()
    expect(state.open).toBe(true)
    expect(state.selectedBookId).toBe(TV_BOOK.id)
    expect(state.selectedKind).toBe('episode')
    expect(state.selectedSeason).toBe(1)
    expect(state.selectedEpisode).toBe(1)

    // 第二次点击 → open=false(选中保留,方便下次打开恢复)
    act(() => {
      fireEvent.click(trigger)
    })
    state = useEpisodeStickyStore.getState()
    expect(state.open).toBe(false)
    expect(state.selectedBookId).toBe(TV_BOOK.id) // 保留
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

  it('5. 浮窗打开后,WorkPicker 列出 tv / anime / movie,过滤 book / other', () => {
    useBooksStore.setState({ books: [TV_BOOK, MOVIE_BOOK, BOOK_ONLY] })
    // 打开浮窗
    act(() => {
      useEpisodeStickyStore.setState({ open: true })
    })
    render(
      <WikilinkProvider>
        <EpisodeNotesSticky />
      </WikilinkProvider>
    )

    // 点标题按钮 → 打开 picker
    act(() => {
      fireEvent.click(screen.getByTestId('sticky-title-btn'))
    })

    // 应有 2 项(tv + movie);book 不在候选
    expect(screen.getByText('假面骑士龙骑')).toBeTruthy()
    expect(screen.getByText('盗梦空间')).toBeTruthy()
    expect(screen.queryByText('百年孤独')).toBeNull()
  })

  it('6. book 删除降级 → 浮窗显示「作品已删除」+ 重选按钮', () => {
    // 选中已删除的 book
    useBooksStore.setState({ books: [] })
    useEpisodeStickyStore.setState({
      open: true,
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
    // 应有「作品已删除 — 重选」按钮
    expect(screen.getByText(/作品已删除/)).toBeTruthy()
  })

  it('7. movie 模式下「01」位不可点 → 显示「—」', () => {
    useBooksStore.setState({ books: [MOVIE_BOOK] })
    useEpisodeStickyStore.setState({
      open: true,
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
    // 应有「—」占位
    const dash = screen.getAllByText('—')[0]
    expect(dash).toBeTruthy()
    // 没有 sticky-episode-btn(movie 模式下不渲染)
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

  it('9. Esc 关闭(焦点在 body,非 editable 内)', () => {
    useBooksStore.setState({ books: [TV_BOOK] })
    useEpisodeStickyStore.setState({
      open: true,
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
    // 焦点在 body,按 Esc
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useEpisodeStickyStore.getState().open).toBe(false)
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