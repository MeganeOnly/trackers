// 回归测试 —— useWikilinkTextarea 的 IME composition 处理
//
// 复现与保护一个 bug（2026-09 修）：
//   1. 中文输入法打字时「汉字突然变成拼音」
//      现象：在 textarea 用中文输入法逐字输入时，每敲一个字母 onChange 触发，
//      e.target.value 是拼音字符（如 "ni"）；如果 hook 直接 setValue(拼音)，
//      React 18 controlled input 会用拼音 prop value 反向覆盖 DOM；
//      用户按空格选词「你」时，IME 想把 DOM 里的拼音替换为汉字，
//      但 React prop value 仍是拼音，controlled input 反向覆盖回拼音。
//      修复：挂 compositionstart / compositionend DOM 监听器，
//      composition 期间 handleChange 跳过 setValue（让 IME 自己管 DOM），
//      compositionend 时手动用 textarea.value（已是汉字）同步给父组件 setValue。
//
// 注：本测试直接打 stub 模拟 IME 序列（compositionstart → input → compositionend），
// 因为 jsdom 不实现真实 IME。React Testing Library 的 userEvent.keyboard
// 也不会模拟 composition 状态。

// @vitest-environment jsdom

import { describe, expect, it, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { WikilinkProvider } from '../WikilinkContext'
import { useWikilinkTextarea } from '../useWikilinkTextarea'
import type { Book } from '@shared/types'

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

interface TestCompProps {
  onSetValue: (v: string) => void
}

function TestComp({ onSetValue }: TestCompProps): JSX.Element {
  const book: Book | undefined = TEST_BOOK
  const [value, setValue] = useState<string>('')
  const { handleChange, taRef } = useWikilinkTextarea({
    book,
    value,
    setValue: (v) => {
      setValue(v)
      onSetValue(v)
    }
  })
  return <textarea ref={taRef} value={value} onChange={handleChange} data-testid="ime-ta" />
}

function mountTestComp(): { onSetValue: ReturnType<typeof vi.fn>; ta: HTMLTextAreaElement } {
  const onSetValue = vi.fn()
  render(
    <WikilinkProvider>
      <TestComp onSetValue={onSetValue} />
    </WikilinkProvider>
  )
  const ta = screen.getByTestId('ime-ta') as HTMLTextAreaElement
  return { onSetValue, ta }
}

describe('useWikilinkTextarea IME composition 处理', () => {
  it('IME 拼音输入期间:handleChange 不应调用 setValue（拼音不能污染 React state）', () => {
    const { onSetValue, ta } = mountTestComp()

    // 进入 IME composition
    act(() => {
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })

    // IME 期间敲一个字母 n → onChange 触发,但 value 是拼音 "n"
    fireEvent.change(ta, { target: { value: 'n', selectionStart: 1, selectionEnd: 1 } })
    fireEvent.change(ta, { target: { value: 'ni', selectionStart: 2, selectionEnd: 2 } })

    // 关键断言:拼音不能写进 React state
    expect(onSetValue).not.toHaveBeenCalled()
  })

  it('IME 选词 commit 汉字后:compositionend 监听器同步汉字给 React state（不是拼音）', () => {
    const { onSetValue, ta } = mountTestComp()

    // 进入 IME composition
    act(() => {
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })

    // IME 拼音状态（onChange 被跳过）
    fireEvent.change(ta, { target: { value: 'ni', selectionStart: 2, selectionEnd: 2 } })
    expect(onSetValue).not.toHaveBeenCalled()

    // 模拟 IME 把汉字「你」commit 到 textarea.value（jsdom 没有真实 IME，手动赋值）
    Object.defineProperty(ta, 'value', { value: '你', configurable: true })

    // 触发 compositionend —— 挂载的 DOM 监听器手动调 setValueRef.current(ta.value)
    act(() => {
      ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })

    // 关键断言:setValue 应被调一次,且传入的是汉字「你」(不是拼音 "ni")
    expect(onSetValue).toHaveBeenCalledTimes(1)
    expect(onSetValue).toHaveBeenCalledWith('你')
  })

  it('composition 结束后,正常打字不再受 IME 状态影响', () => {
    const { onSetValue, ta } = mountTestComp()

    // 完成一轮 IME 流程
    act(() => {
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    })
    Object.defineProperty(ta, 'value', { value: '你', configurable: true })
    act(() => {
      ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    expect(onSetValue).toHaveBeenCalledTimes(1)
    expect(onSetValue).toHaveBeenLastCalledWith('你')

    // 紧接着正常打字 —— 用 Object.defineProperty 直接设 DOM value,
    // 避开 jsdom + React 18 controlled input commit 时序陷阱(AGENTS.md §十.44)
    Object.defineProperty(ta, 'value', { value: '你好', configurable: true })
    fireEvent.change(ta)

    // 应正常透传 setValue,且不再受 IME 状态拦截
    expect(onSetValue).toHaveBeenCalledTimes(2)
    expect(onSetValue).toHaveBeenLastCalledWith('你好')
  })
})
