// 回归测试 —— StampRow wikilink 与时间戳编辑
//
// 复现与保护两个 bug（v2025-09 修）：
//   1. 逐字符键入 `[[` 不触发角色选择 picker
//      根因：直接 `value={stamp.note}` + 每次 keystroke 同步触发 IPC；
//      React 18 controlled input 在快速连续 keystroke 时把第二次输入吞掉
//      修复：本地 noteDraft + debounce 500ms flush（与 CharacterEditor 同款）
//   2. UI 没有提供修改 stamp.start / stamp.end 的入口
//      修复：单击时间戳文字 → inline 编辑态（start mm + ss / → / end mm + ss，可空）；
//      blur / 回车 → onEditStart / onEditEnd 写 store
//
// 注：React 18 受控 input 在 jsdom 下用 fireEvent.change / userEvent.paste 模拟
// 不可靠（React commit 异步 vs fireEvent 同步；test 中 input.value 与 state 不同步）。
// 因此本测试只覆盖可稳定断言的部分：DOM 结构 + 关键交互的最终状态。

// @vitest-environment jsdom

// jsdom 缺 scrollIntoView —— picker 的 useEffect 调它会抛错，给 HTMLElement.prototype 打 stub
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

import { describe, expect, it, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WikilinkProvider } from '../WikilinkContext'
import { StampRow } from '../EpisodesPanel'
import type { Book, TimeStamp } from '@shared/types'

afterEach(() => {
  cleanup()
})

const TEST_BOOK: Book = {
  id: '1',
  title: 'Test Book',
  status: 'reading',
  kind: 'tv',
  author: '',
  country: '',
  year: 0,
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
  characters: [
    { id: 'c1', name: 'Alice', notes: undefined },
    { id: 'c2', name: 'Bob', notes: undefined }
  ]
}

const TEST_STAMP: TimeStamp = {
  id: 'stamp-1',
  start: 30,
  end: 60,
  note: ''
}

interface MountedHandles {
  onEditNote: (raw: string) => void
  onEditStart: (start: number) => void
  onEditEnd: (end: number | undefined) => void
  onDelete: () => void
}

function renderStampRow(initial: TimeStamp = TEST_STAMP): {
  handlers: MountedHandles
  setStamp: (s: TimeStamp) => void
} {
  const handlers: MountedHandles = {
    onEditNote: () => {},
    onEditStart: () => {},
    onEditEnd: () => {},
    onDelete: () => {}
  }
  const Wrap = (): JSX.Element => {
    const [stamp, setStamp] = useState<TimeStamp>(initial)
    setStampRef.current = setStamp
    return (
      <WikilinkProvider>
        <StampRow
          stamp={stamp}
          book={TEST_BOOK}
          allBooks={[TEST_BOOK]}
          onEditNote={(v) => {
            handlers.onEditNote(v)
            setStamp({ ...stamp, note: v })
          }}
          onEditStart={(start) => {
            handlers.onEditStart(start)
            setStamp({ ...stamp, start })
          }}
          onEditEnd={(end) => {
            handlers.onEditEnd(end)
            setStamp({ ...stamp, end })
          }}
          onDelete={() => handlers.onDelete()}
        />
      </WikilinkProvider>
    )
  }
  const setStampRef: { current: (s: TimeStamp) => void } = { current: () => {} }
  render(<Wrap />)
  return { handlers, setStamp: (s) => setStampRef.current(s) }
}

describe('StampRow wikilink 触发回归测试', () => {
  it('逐字符键入 `[[` 应该触发角色选择 picker', async () => {
    const user = userEvent.setup()
    renderStampRow({ ...TEST_STAMP, note: '' })

    const ta = screen.getByTestId('stamp-row-note-input') as HTMLTextAreaElement
    await user.click(ta)
    await user.keyboard('{[}')
    await user.keyboard('{[}')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    const pickerSearch = document.querySelector('.wikilink-picker-search')
    expect(pickerSearch).not.toBeNull()
  })
})

describe('StampRow 时间戳 inline 编辑回归测试', () => {
  it('单击时间戳文字 → 切换到 inline 编辑态（出现 start/end 输入框）', async () => {
    const user = userEvent.setup()
    renderStampRow({ ...TEST_STAMP, start: 30, end: 60 })

    const timeDisplay = screen.getByTestId('stamp-row-time-display')
    expect(timeDisplay).not.toBeNull()
    await user.click(timeDisplay)

    expect(screen.getByTestId('stamp-row-start-min')).not.toBeNull()
    expect(screen.getByTestId('stamp-row-start-sec')).not.toBeNull()
    expect(screen.getByTestId('stamp-row-end-min')).not.toBeNull()
    expect(screen.getByTestId('stamp-row-end-sec')).not.toBeNull()
  })

  it('开始时间已填的 stamp 进入编辑态时,start 输入框回填原值', async () => {
    const user = userEvent.setup()
    renderStampRow({ ...TEST_STAMP, start: 185, end: 240 })
    // 185 秒 = "03:05",240 秒 = "04:00"

    await user.click(screen.getByTestId('stamp-row-time-display'))

    const startMin = screen.getByTestId('stamp-row-start-min') as HTMLInputElement
    const startSec = screen.getByTestId('stamp-row-start-sec') as HTMLInputElement
    const endMin = screen.getByTestId('stamp-row-end-min') as HTMLInputElement
    const endSec = screen.getByTestId('stamp-row-end-sec') as HTMLInputElement
    expect(startMin.value).toBe('03')
    expect(startSec.value).toBe('05')
    expect(endMin.value).toBe('04')
    expect(endSec.value).toBe('00')
  })

  it('单时间点 stamp(end undefined)进入编辑态,end 输入框为空', async () => {
    const user = userEvent.setup()
    renderStampRow({ ...TEST_STAMP, start: 90, end: undefined })

    await user.click(screen.getByTestId('stamp-row-time-display'))

    const endMin = screen.getByTestId('stamp-row-end-min') as HTMLInputElement
    const endSec = screen.getByTestId('stamp-row-end-sec') as HTMLInputElement
    expect(endMin.value).toBe('')
    expect(endSec.value).toBe('')
  })
})