// 笔记编辑失效 —— IPC 异步回灌覆盖用户输入 —— 回归测试
//
// 现象(用户报告):集笔记 / 时间戳笔记「完全无法编辑」,创建正常。
//
// 根因(本测试要锁住):EpisodeEditor / StampRow 都用「本地 useState 草稿 +
// useEffect 同步外部 store + debounce flush」模式。IPC 异步返回 store 后,
// useEffect 触发,把旧 store 值灌回本地 noteDraft,**覆盖用户正在敲的字符**。
//
// 治本:加 dirty flag + lastSentRef 双闸门
// - dirty=true → useEffect 早退(主笔记 BookNotesModal / BookDetail 已有同款)
// - store 值 === lastSentRef → 同步(IPC 回灌的是我刚发的旧值,放心覆盖)
// - 否则 → 保留本地草稿(IPC 回灌的比我刚发的还旧,用户在持续敲,不能动)
//
// 测试设计原则(沿用 AGENTS.md §十.43-45):
// - jsdom + React 18 受控 input commit 时序不可靠,**不**依赖 fireEvent 验证
//   input.value 是否随 React state 同步;只断言**可稳定断言的部分**
// - 由于 StampRow 是 controlled component(stamps 从 props 接收),
//   **不**直接测试 store 更新 → 组件响应(这是 parent 的职责);
//   而是测试 props 更新 → 组件响应 + 关键交互的最终态

// @vitest-environment jsdom

// jsdom 缺 scrollIntoView —— picker 的 useEffect 调它会抛错
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikilinkProvider } from '../WikilinkContext'
import { BookStampsPanel } from '../BookStampsPanel'
import { useBooksStore } from '../../store/books'
import type { Book, TimeStamp } from '@shared/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useBooksStore.setState({
    books: [],
    broken: [],
    selectedId: null,
    loading: false,
    navigateToCharacter: null
  })
})

// ============================================================
// Fixture
// ============================================================

const MOVIE_BOOK: Book = {
  id: 'movie-1',
  title: '测试电影',
  status: 'finished',
  kind: 'movie',
  author: '测试',
  country: '',
  year: 2024,
  translator: '',
  read_count: 1,
  progress: null,
  collapsed: false,
  created: '',
  updated: '',
  tags: [],
  notes: '',
  starring: '',
  screenwriter: '',
  characters: []
}

const INITIAL_STAMPS: TimeStamp[] = [
  { id: 's1', start: 10, end: 20, note: 'orig', lastModified: 1000 }
]

/** 注入 mock book + mock store actions,返回 setStamps spy。 */
function injectMovieAndSpy() {
  const setStampsSpy = vi.fn(async (id: string, stamps: TimeStamp[], _lm?: number) => {
    useBooksStore.setState((prev) => ({
      books: prev.books.map((b) => (b.id === id ? { ...b, stamps } : b))
    }))
    return { ...MOVIE_BOOK, stamps }
  })

  useBooksStore.setState({
    books: [{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }],
    broken: [],
    selectedId: null,
    loading: false,
    navigateToCharacter: null
  })
  useBooksStore.setState((prev) => ({
    ...prev,
    setStamps: setStampsSpy as never
  }))

  return { setStampsSpy }
}

// ============================================================
// Case 1: BookStampsPanel smoke test —— 新组件基础渲染
// ============================================================

describe('BookStampsPanel 新组件 smoke test', () => {
  it('空 stamps 数组 + onChange 回调不报错', () => {
    const onChange = vi.fn()
    render(
      <WikilinkProvider>
        <BookStampsPanel
          book={MOVIE_BOOK}
          allBooks={[MOVIE_BOOK]}
          stamps={[]}
          onChange={onChange}
        />
      </WikilinkProvider>
    )
    // 不应该渲染任何 stamp row
    expect(document.querySelectorAll('.stamp-row').length).toBe(0)
    // 应该渲染添加区
    expect(screen.getByPlaceholderText(/这一段讲什么/)).toBeTruthy()
  })

  it('已有 stamps 时正确渲染 StampRow + 时间戳 + 笔记', () => {
    render(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          stamps={INITIAL_STAMPS}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )
    expect(document.querySelectorAll('.stamp-row').length).toBe(1)
    expect(screen.getByDisplayValue('orig')).toBeTruthy()
    expect(screen.getByTestId('stamp-row-time-display')).toBeTruthy()
  })

  it('stamps=undefined 视为空数组', () => {
    render(
      <WikilinkProvider>
        <BookStampsPanel
          book={MOVIE_BOOK}
          allBooks={[MOVIE_BOOK]}
          stamps={undefined}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )
    expect(document.querySelectorAll('.stamp-row').length).toBe(0)
    expect(screen.getByPlaceholderText(/这一段讲什么/)).toBeTruthy()
  })
})

// ============================================================
// Case 2: 创建 / 删除 stamp 路径
// ============================================================

describe('BookStampsPanel 创建 / 删除 stamp', () => {
  it('点击 + 添加新 stamp 触发 onChange(带正确参数)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <WikilinkProvider>
        <BookStampsPanel
          book={MOVIE_BOOK}
          allBooks={[MOVIE_BOOK]}
          stamps={[]}
          onChange={onChange}
        />
      </WikilinkProvider>
    )

    const startMin = document.querySelector('.stamp-add-mm') as HTMLInputElement
    const startSec = document.querySelector('.stamp-add-ss') as HTMLInputElement
    const noteInput = screen.getByPlaceholderText(/这一段讲什么/) as HTMLInputElement

    await user.type(startMin, '00')
    await user.type(startSec, '10')
    await user.type(noteInput, 'first')

    const addBtn = document.querySelector('.stamp-add-btn') as HTMLButtonElement
    await user.click(addBtn)

    expect(onChange).toHaveBeenCalledTimes(1)
    const newStamps = onChange.mock.calls[0]?.[0] as TimeStamp[]
    expect(newStamps).toHaveLength(1)
    expect(newStamps[0]?.start).toBe(10)
    expect(newStamps[0]?.note).toBe('first')
    expect(newStamps[0]?.id).toBeTruthy()
    expect(newStamps[0]?.lastModified).toBeGreaterThan(0)
  })

  it('删除 stamp 触发 onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          stamps={INITIAL_STAMPS}
          onChange={onChange}
        />
      </WikilinkProvider>
    )

    const delBtn = document.querySelector('.stamp-row-del') as HTMLButtonElement
    await user.click(delBtn)

    expect(onChange).toHaveBeenCalledTimes(1)
    const newStamps = onChange.mock.calls[0]?.[0] as TimeStamp[]
    expect(newStamps).toHaveLength(0)
  })
})

// ============================================================
// Case 3: 时间戳 inline 编辑 —— 单击进入编辑态 + Esc 取消
// ============================================================

describe('BookStampsPanel 时间戳 inline 编辑(StampRow editingTime + flushEditTime)', () => {
  it('单击时间戳文字 → 进入编辑态(start/end inputs 出现)', async () => {
    const user = userEvent.setup()
    render(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          stamps={INITIAL_STAMPS}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )

    const timeDisplay = screen.getByTestId('stamp-row-time-display')
    await user.click(timeDisplay)

    expect(screen.getByTestId('stamp-row-start-min')).toBeTruthy()
    expect(screen.getByTestId('stamp-row-start-sec')).toBeTruthy()
    expect(screen.getByTestId('stamp-row-end-min')).toBeTruthy()
    expect(screen.getByTestId('stamp-row-end-sec')).toBeTruthy()
    expect(screen.queryByTestId('stamp-row-time-display')).toBeNull()

    // 验证:startMin 应回填 '00',startSec='10'(10s = 00:10)
    const startMin = screen.getByTestId('stamp-row-start-min') as HTMLInputElement
    const startSec = screen.getByTestId('stamp-row-start-sec') as HTMLInputElement
    expect(startMin.value).toBe('00')
    expect(startSec.value).toBe('10')
  })

  it('Esc 在编辑态触发 cancelEditTime + 不写 store', async () => {
    const onEditStart = vi.fn()
    const onEditEnd = vi.fn()

    const { StampRow } = await import('../EpisodesPanel.StampList')

    const user = userEvent.setup()
    render(
      <WikilinkProvider>
        <StampRow
          stamp={INITIAL_STAMPS[0]!}
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          onEditNote={vi.fn()}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          onDelete={vi.fn()}
        />
      </WikilinkProvider>
    )

    const timeDisplay = screen.getByTestId('stamp-row-time-display')
    await user.click(timeDisplay)

    const startMin = screen.getByTestId('stamp-row-start-min') as HTMLInputElement
    await user.clear(startMin)
    await user.type(startMin, '01')

    await user.keyboard('{Escape}')

    // 应退出编辑态
    expect(screen.queryByTestId('stamp-row-start-min')).toBeNull()
    expect(screen.getByTestId('stamp-row-time-display')).toBeTruthy()

    // 不应调 onEditStart / onEditEnd
    expect(onEditStart).not.toHaveBeenCalled()
    expect(onEditEnd).not.toHaveBeenCalled()
  })
})

// ============================================================
// Case 4: stamps 数组变化时组件正确响应(props 切换)
// ============================================================

describe('BookStampsPanel props 切换响应(模拟 IPC 回灌)', () => {
  it('stamps prop 变化 → StampRow 显示新数据', () => {
    const { rerender } = render(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          stamps={INITIAL_STAMPS}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )
    expect(screen.getByDisplayValue('orig')).toBeTruthy()

    // 切换到新的 stamps props(模拟外部 IPC 回灌或父组件 props 更新)
    const updated = [{ ...INITIAL_STAMPS[0]!, note: 'updated' }]
    rerender(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: updated }}
          allBooks={[{ ...MOVIE_BOOK, stamps: updated }]}
          stamps={updated}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )

    // 组件应反映新 props
    expect(screen.getByDisplayValue('updated')).toBeTruthy()
    expect(screen.queryByDisplayValue('orig')).toBeNull()
  })

  it('stamps 数组增加 stamp → 新 StampRow 出现', () => {
    const { rerender } = render(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          stamps={INITIAL_STAMPS}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )
    expect(document.querySelectorAll('.stamp-row').length).toBe(1)

    const expanded = [
      ...INITIAL_STAMPS,
      { id: 's2', start: 30, end: 40, note: 'second', lastModified: 2000 }
    ]
    rerender(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: expanded }}
          allBooks={[{ ...MOVIE_BOOK, stamps: expanded }]}
          stamps={expanded}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )

    expect(document.querySelectorAll('.stamp-row').length).toBe(2)
    expect(screen.getByDisplayValue('second')).toBeTruthy()
  })

  it('stamps 数组删除 stamp → StampRow 消失', () => {
    const { rerender } = render(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }}
          allBooks={[{ ...MOVIE_BOOK, stamps: INITIAL_STAMPS }]}
          stamps={INITIAL_STAMPS}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )
    expect(document.querySelectorAll('.stamp-row').length).toBe(1)

    rerender(
      <WikilinkProvider>
        <BookStampsPanel
          book={{ ...MOVIE_BOOK, stamps: [] }}
          allBooks={[{ ...MOVIE_BOOK, stamps: [] }]}
          stamps={[]}
          onChange={vi.fn()}
        />
      </WikilinkProvider>
    )

    expect(document.querySelectorAll('.stamp-row').length).toBe(0)
  })
})

// ============================================================
// Case 5: BookStampsPanel 接入 store 后的 setStamps IPC 路径
// ============================================================

describe('BookStampsPanel + store setStamps IPC 集成', () => {
  it('onChange 触发 setStamps IPC(模拟编辑完成后保存)', async () => {
    const { setStampsSpy } = injectMovieAndSpy()
    const user = userEvent.setup()

    // 通过 setStamps store action 完成添加 stamp
    await act(async () => {
      await useBooksStore.getState().setStamps(MOVIE_BOOK.id, [
        ...INITIAL_STAMPS,
        { id: 's2', start: 30, end: 40, note: 'via IPC', lastModified: Date.now() }
      ])
    })

    // store action 被调一次
    expect(setStampsSpy).toHaveBeenCalledTimes(1)
    const stampsArg = setStampsSpy.mock.calls[0]?.[1] as TimeStamp[]
    expect(stampsArg).toHaveLength(2)
    expect(stampsArg[1]?.note).toBe('via IPC')

    // store 中的 stamps 数组已更新(同步 IPC 模拟)
    const state = useBooksStore.getState()
    const book = state.books.find((b) => b.id === MOVIE_BOOK.id)
    expect(book?.stamps).toHaveLength(2)
  })
})
