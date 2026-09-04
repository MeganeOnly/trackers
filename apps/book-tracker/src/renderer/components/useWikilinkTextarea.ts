// 作品双链 `[[角色名]]` —— textarea 集成 hook
//
// 复用 4 处 textarea(Book.notes / Character.notes / EpisodeRecord.note / TimeStamp.note)
// 的 `[[` 检测 + 插入逻辑,避免每个父组件重复实现。
//
// 用法:
// ```tsx
// const [notes, setNotes] = useState(book.notes ?? '')
// const { handleChange, taRef } = useWikilinkTextarea({
//   book,
//   value: notes,
//   setValue: setNotes
// })
// return (
//   <>
//     <textarea ref={taRef} value={notes} onChange={handleChange} ... />
//     <WikilinkText text={notes} currentBook={book} allBooks={books} />
//   </>
// )
// ```
//
// 设计:
// - **不持有 value**:hook 接收 value + setValue,父组件自己管本地 draft(与现有
//   CharactersPanel 的 noteDraft / EpisodesPanel 的 noteDraft 一致,父组件自己
//   决定何时 debounce flush 到 store)
// - **`[[` 触发检测**:onChange 时检查 value.slice(cursorPos - 2, cursorPos) === '[[',
//   且 cursorPos - 2 之前不是 `[[`(避免 [[[ 的中间触发)
// - **光标定位**:onResolve 后用 setTimeout(0) 在 React commit 后 setSelectionRange,
//   确保 setValue 引发的 re-render 不冲掉光标
// - **用户中间输入**:picker 打开后用户在 textarea 继续敲的内容会被
//   `value.slice(cursorPos)` 截到 after 段,最终插入后追加在 `]]` 后面。
//   这是已知行为(见 v1.7 dev-notes 「wikilink 中间输入处理」)。

import { useCallback, useRef } from 'react'
import type { Book } from '@shared/types'
import { collectLocalCharacterCandidates } from '@shared/wikilink'
import { useWikilink } from './WikilinkContext'

interface UseWikilinkTextareaOpts {
  /**
   * 当前作品(用于 picker 候选)。**允许 undefined** —— 父组件在
   * `if (!book) return ...` 之前调用 hook 时需要这样传,避免 Rules of Hooks 违规。
   * book 为 undefined 时 handleChange 是 no-op(只透传 setValue,不触发 picker)。
   */
  book: Book | undefined
  /** 当前 textarea 的值(由父组件管理) */
  value: string
  /** 父组件的 setValue —— hook 调用它做插入 */
  setValue: (v: string) => void
}

export interface UseWikilinkTextareaReturn {
  /** 父组件绑给 textarea 的 onChange */
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  /**
   * 父组件绑给 textarea 的 ref。可写 current(因为父组件可能要把自己的 ref
   * 与 hook 的 ref 合并,如 StampRow 的自动撑高需要 textareaRef.current)。
   */
  taRef: React.MutableRefObject<HTMLTextAreaElement | null>
}

/**
 * 给一个 textarea 加上 `[[` 触发 wikilink picker 的能力。
 *
 * 不持有 value —— 父组件传 value/setValue 进来;hook 只负责:
 * 1. 拦截 onChange,检测 `[[` 触发 picker
 * 2. picker 解析后,基于 value 当前快照 + 触发时光标位置构造新 value,调 setValue
 * 3. 等 React commit 后重置光标到 `]]` 之后
 */
export function useWikilinkTextarea(opts: UseWikilinkTextareaOpts): UseWikilinkTextareaReturn {
  const { book, value, setValue } = opts
  const wikilink = useWikilink()
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingCursorRef = useRef<number | null>(null)

  const insertWikilink = useCallback(
    (name: string, snapshotValue: string): void => {
      const cursorPos = pendingCursorRef.current
      pendingCursorRef.current = null
      if (cursorPos === null) return
      const before = snapshotValue.slice(0, cursorPos)
      const after = snapshotValue.slice(cursorPos)
      // 如果用户已经敲了闭合 ]] → 删掉,避免 [[name]]]]
      const endTrim = after.startsWith(']]') ? 2 : 0
      const newValue = before + name + ']]' + after.slice(endTrim)
      const newCursor = before.length + name.length + 2
      setValue(newValue)
      // 等 React commit 后再设光标;setTimeout 0 等价于「下个 tick」
      setTimeout(() => {
        const ta = taRef.current
        if (ta) ta.setSelectionRange(newCursor, newCursor)
      }, 0)
    },
    [setValue]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart ?? newValue.length
      // 透传 value 变更给父组件(父组件决定何时 flush)
      setValue(newValue)

      // book 未定义时直接透传,不触发 picker(避免在「未选作品」状态下打开 picker)
      if (!book) return

      // 检测 [[ 触发 —— 只在「刚输入第二 [」时触发,避免 [[[ 重复触发
      if (cursorPos >= 2 && newValue.slice(cursorPos - 2, cursorPos) === '[[') {
        const prevChar = cursorPos >= 3 ? newValue.slice(cursorPos - 3, cursorPos - 2) : ''
        if (prevChar !== '[') {
          pendingCursorRef.current = cursorPos
          wikilink.openPicker({
            bookId: book.id,
            candidates: collectLocalCharacterCandidates(book),
            initialName: '',
            onResolve: (name) => insertWikilink(name, newValue)
          })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book?.id, book, wikilink, insertWikilink]
  )

  return { handleChange, taRef }
}
