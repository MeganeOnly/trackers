// Book 顶层 stamps 面板(v2.x 新增;目前仅 movie 实际使用)。
//
// 复用 `EpisodesPanel.StampList` 的渲染逻辑 —— 该组件已经 prop-driven(book /
// allBooks / stamps / onChange),可直接在作品顶层使用,不需要拆 / 重写。
// 本组件做三件事:
//   1) 包一层 `<section class="panel book-stamps-panel">` 跟其他面板(CharactersPanel /
//      EpisodesPanel)视觉对齐
//   2) 提供一个可选的标题(目前固定为「时间戳笔记」,未来 book 接入时可换「页码笔记」)
//   3) 提供 store action 接入(`onChange` 由父组件 BooksStore 派生)
//
// **设计取舍**:不内嵌 store action,让父组件注入 —— 跟 CharactersPanel /
// EpisodesPanel 同款(避免组件直接依赖 store,测试和复用更友好)。
//
// **数据语义**(与 EpisodeRecord.stamps 完全平行):
// - stamps 数组为空 → UI 仍渲染添加区(用户可以加)
// - stamps 为 undefined → UI 视作空数组
// - onChange 收到的是排序后的数组(sortStamps 由 StampList 内部保证)
// - 父组件接到 onChange 后:**整段替换 + 走 books.setStamps IPC**(整体替换语义,
//   不做单条 add/edit/delete;服务端兜底排序 + 稀疏写盘)

import type { Book, TimeStamp } from '@shared/types'
import { StampList } from './EpisodesPanel.StampList'

export interface BookStampsPanelProps {
  /** 当前作品 —— 用于 stamp note 的 wikilink picker(若启用跨作品跳转) */
  book: Book
  /** 全作品列表 —— wikilink 跨作品解析用 */
  allBooks: Book[]
  /** 当前作品的顶层 stamps 数组(undefined 视为空) */
  stamps: TimeStamp[] | undefined
  /** 整段替换回调 —— 父组件接到后走 store action + IPC */
  onChange: (stamps: TimeStamp[]) => void
}

/**
 * 顶层时间戳笔记面板(v2.x 新增;目前仅 movie 实际使用,UI 在 BookDetail 里按 kind 渲染)。
 *
 * 用法:
 * ```tsx
 * <BookStampsPanel
 *   book={cur}
 *   allBooks={books}
 *   stamps={cur.stamps}
 *   onChange={(s) => setStamps(cur.id, s)}
 * />
 * ```
 */
export function BookStampsPanel({
  book,
  allBooks,
  stamps,
  onChange
}: BookStampsPanelProps): JSX.Element {
  return (
    <section className="panel book-stamps-panel">
      <StampList
        book={book}
        allBooks={allBooks}
        stamps={stamps ?? []}
        onChange={onChange}
        withStickyTrigger
      />
    </section>
  )
}
