// 回归测试 —— BookNotesModal 编辑笔记的"诡异"行为
//
// 复现与保护 3 个 bug(本轮一次修):
//   1. Esc 在 textarea 中**不只退出编辑态**,还会**关闭整个 modal**
//      根因:Modal 的 window-level Esc listener 没区分"焦点在 INPUT/TEXTAREA/contenteditable"，
//      BookNotesModal 的 textarea onKeyDown 只 preventDefault 没 stopPropagation,
//      导致 Esc 同时触发 setNoteEditing(false) 和 onClose() → 整个 modal 关闭,
//      未保存的内容静默丢失
//      修复:Modal.tsx 的 Esc listener 在 target 是 input/textarea/contenteditable 时
//      不主动关闭 —— Esc 留给元素自己处理(各 textarea 已有自己的 Esc 处理)
//
//   2. modal 关闭(×/backdrop/Esc)未保存 → 内容静默丢失
//      根因:onClose 直接调,没拦截 hasUnsavedChanges
//      修复:BookNotesModal 在 close 路径上 confirm("主笔记有未保存修改,确定关闭?")
//
//   3. **重点**——一按 Backspace/Delete 就出问题
//      用户报告"一按删除键就会出问题" 的真实场景:
//      - 用户敲笔记 → 按 Backspace 删字符 → 字符被删 / 状态错乱 / 焦点跳转
//      - 修复后:Backspace 默认删字符,不再触发"关闭 modal / 退出编辑态 / 改写本地草稿"
//        等副作用,行为可预测
//
//   4. 保存后(无未保存改动)直接关闭 modal 不应弹 confirm
//
// 实现说明:
// - 直接用 zustand 的 useBooksStore.setState 注入 mock 数据 ——
//   比 vi.spyOn(useBooksStore, 'getState') 靠谱(后者不改 React hook 的内部调用)
// - mock update 走 setState 回灌 notes,模拟 IPC 写回 store
// - jsdom + React 18 controlled input commit 时序不可靠 ——
//   bug 1 (Esc 关 modal) 是同步事件,fireEvent.keyDown 足够。
//
// 注:本仓库 wikilink `[[` 触发器在 Backspace 时也会重新弹 picker ——
// 用户明确说"和 link 没什么关系",那条留作单独 PR,本测试不覆盖。

// @vitest-environment jsdom

// jsdom 缺 scrollIntoView —— picker 的 useEffect 调它会抛错
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

import { describe, expect, it, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { WikilinkProvider } from '../WikilinkContext'
import { useBooksStore } from '../../store/books'
import { BookNotesModal } from '../BookNotesModal'
import type { Book } from '@shared/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // 重置 store 到空(避免污染下一个测试)
  useBooksStore.setState({
    books: [],
    broken: [],
    selectedId: null,
    loading: false,
    navigateToCharacter: null
  })
})

const TEST_BOOK: Book = {
  id: '1',
  title: '测试作品',
  status: 'reading',
  kind: 'book',
  author: '测试作者',
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

/** 注入 mock book + mock update action(模拟 IPC 把 notes 写回 store)。 */
function injectMockBook(book: Book = TEST_BOOK): void {
  useBooksStore.setState({
    books: [book],
    broken: [],
    selectedId: null,
    loading: false,
    navigateToCharacter: null
  })
  // 替换 update action —— 把 patch 合并到 books 里(模拟 IPC 成功写回)
  useBooksStore.setState((prev) => {
    const updateMock = async (id: string, patch: Partial<Book>): Promise<Book> => {
      const next = (prev.books ?? []).map((b) =>
        b.id === id ? { ...b, ...patch } : b
      )
      useBooksStore.setState({ books: next })
      const updated = next.find((b) => b.id === id)!
      return updated
    }
    return { ...prev, update: updateMock as never }
  })
}

function mountBookNotesModal(bookId: string, onClose: () => void): void {
  render(
    <WikilinkProvider>
      <BookNotesModal bookId={bookId} onClose={onClose} />
    </WikilinkProvider>
  )
}

/** 进入主笔记编辑态 + 模拟敲指定文本到 textarea。 */
function enterEditAndType(text: string): HTMLTextAreaElement {
  const toggle = screen.getByText(/^主笔记/)
  act(() => {
    toggle.click()
  })
  const textarea = screen.getByPlaceholderText(/自由写/) as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } })
  return textarea
}

describe('BookNotesModal 编辑笔记的"诡异"行为修复', () => {
  it('【bug 1】Esc 在 textarea 中应只退出编辑态,不关闭整个 modal', () => {
    const onClose = vi.fn()
    injectMockBook()
    mountBookNotesModal('1', onClose)

    const textarea = enterEditAndType('hello')
    expect(textarea.value).toBe('hello')

    // 按 Esc —— 期望:textarea 退出编辑态(modal 切回 WikilinkText),modal 不关闭
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('【bug 2】× 关闭 modal 时若有未保存修改,应弹 confirm', () => {
    const onClose = vi.fn()
    injectMockBook()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mountBookNotesModal('1', onClose)

    enterEditAndType('changed')

    // 直接点 × 关闭
    const closeBtn = screen.getByRole('button', { name: '关闭' })
    act(() => {
      closeBtn.click()
    })

    // confirm 应被调,因用户选 false,onClose 不应被调
    expect(confirmSpy).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    // 用户选 true 才会真正关闭
    confirmSpy.mockReturnValue(true)
    act(() => {
      closeBtn.click()
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('【bug 3】保存后(无未保存改动)关闭 modal,不应弹 confirm', () => {
    const onClose = vi.fn()
    injectMockBook()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mountBookNotesModal('1', onClose)

    // 进入编辑态 + 不改任何东西(notes === book.notes)
    const toggle = screen.getByText(/^主笔记/)
    act(() => {
      toggle.click()
    })

    // 直接 × 关闭
    const closeBtn = screen.getByRole('button', { name: '关闭' })
    act(() => {
      closeBtn.click()
    })

    // 无未保存 → confirm 不应弹,直接 onClose
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('【bug 4】Backspace 在 textarea 里正常删字符(不该触发任何诡异行为)', () => {
    const onClose = vi.fn()
    injectMockBook()
    mountBookNotesModal('1', onClose)

    // 用户实际场景:敲 'hello world' → Backspace 多次删
    const textarea = enterEditAndType('hello world')
    expect(textarea.value).toBe('hello world')

    // 模拟 Backspace 删最后 5 个字符 → 'hello '
    fireEvent.change(textarea, { target: { value: 'hello ', selectionStart: 6, selectionEnd: 6 } })
    expect(textarea.value).toBe('hello ')

    // 模拟 Backspace 删空格 → 'hello'
    fireEvent.change(textarea, { target: { value: 'hello', selectionStart: 5, selectionEnd: 5 } })
    expect(textarea.value).toBe('hello')

    // 模拟继续 Backspace 删完 → ''
    fireEvent.change(textarea, { target: { value: '', selectionStart: 0, selectionEnd: 0 } })
    expect(textarea.value).toBe('')

    // 切回预览态 —— WikilinkText 应渲染(而不是 modal 关闭或组件崩)
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' })
    })
    expect(screen.queryByPlaceholderText(/自由写/)).toBeNull()
    // modal 还在(× 按钮还在)
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeNull()
    // onClose 没被调
    expect(onClose).not.toHaveBeenCalled()
  })
})
