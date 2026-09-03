import { create } from 'zustand'
import { api } from '../lib/api'
import type { Book, BookInput, SeasonInfo, TimeStamp } from '@shared/types'

interface BooksState {
  books: Book[]
  broken: { id: string; error: string }[]
  selectedId: string | null
  loading: boolean
  load: () => Promise<void>
  select: (id: string | null) => void
  create: (input: BookInput) => Promise<Book>
  update: (id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[]; progress?: BookInput['progress']; notes?: string; starring?: string; screenwriter?: string; seasons?: SeasonInfo[] }) => Promise<Book>
  bumpProgress: (id: string, delta: number) => Promise<Book>
  remove: (id: string) => Promise<void>
  // -------- v1.2 集笔记 actions --------
  /** 整段替换季信息。`seasons: []` 等同清空 */
  setSeasons: (id: string, seasons: SeasonInfo[]) => Promise<Book>
  /** 切换单集 watched */
  setEpisodeWatched: (id: string, season: number, episode: number, watched: boolean) => Promise<Book>
  /** 设置单集笔记;空串 → 删 key */
  setEpisodeNote: (id: string, season: number, episode: number, note: string) => Promise<Book>
  /** 设置单集标题;空串 → 删 title 字段 */
  setEpisodeTitle: (id: string, season: number, episode: number, title: string) => Promise<Book>
  /** 清空整部剧所有 episodes */
  clearEpisodes: (id: string) => Promise<Book>
  /** 进度 +1/-1 联动集笔记 */
  episodeBump: (id: string, delta: number) => Promise<Book>
  // -------- v1.3 时间戳笔记 actions --------
  /**
   * 整体替换单集的时间戳笔记数组。
   * - `stamps: []` → 清空该集所有 stamp(若该集也没其他字段则删 key)
   * - `stamps: [...]` → 整体替换;前端可按需先合并 + 排序,服务端会再次排序兜底
   */
  setEpisodeStamps: (id: string, season: number, episode: number, stamps: TimeStamp[]) => Promise<Book>
}

/**
 * 把更新后的 book 写回 store books 列表(若 id 命中)。
 * 抽出来避免每个 action 都重复 `set((s) => ({ books: s.books.map(...) }))`。
 * 用 zustand set 的函数形式,只覆盖 books 字段,不污染其他 state。
 */
function upsertBook(
  set: (fn: (s: BooksState) => Partial<BooksState>) => void,
  book: Book
): void {
  set((s) => ({ books: s.books.map((b) => (b.id === book.id ? book : b)) }))
}

export const useBooksStore = create<BooksState>((set) => ({
  books: [],
  broken: [],
  selectedId: null,
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      const { books, broken } = await api.books.list()
      set({ books, broken, loading: false })
    } catch (e) {
      console.error('books load failed:', e)
      set({ loading: false })
    }
  },
  select: (id) => set({ selectedId: id }),
  create: async (input) => {
    const book = await api.books.create(input)
    set((s) => ({ books: [...s.books, book] }))
    return book
  },
  update: async (id, patch) => {
    const book = await api.books.update(id, patch)
    upsertBook(set, book)
    return book
  },
  bumpProgress: async (id, delta) => {
    const book = await api.books.progressBump(id, delta)
    upsertBook(set, book)
    return book
  },
  remove: async (id) => {
    await api.books.delete(id)
    set((s) => ({
      books: s.books.filter((b) => b.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId
    }))
  },
  // -------- v1.2 集笔记 actions 实现 --------
  setSeasons: async (id, seasons) => {
    const book = await api.books.seasonsSet(id, seasons)
    upsertBook(set, book)
    return book
  },
  setEpisodeWatched: async (id, season, episode, watched) => {
    const book = await api.books.episodeSetWatched(id, season, episode, watched)
    upsertBook(set, book)
    return book
  },
  setEpisodeNote: async (id, season, episode, note) => {
    const book = await api.books.episodeSetNote(id, season, episode, note)
    upsertBook(set, book)
    return book
  },
  setEpisodeTitle: async (id, season, episode, title) => {
    const book = await api.books.episodeSetTitle(id, season, episode, title)
    upsertBook(set, book)
    return book
  },
  clearEpisodes: async (id) => {
    const book = await api.books.episodesClear(id)
    upsertBook(set, book)
    return book
  },
  episodeBump: async (id, delta) => {
    const book = await api.books.episodeBump(id, delta)
    upsertBook(set, book)
    return book
  },
  // -------- v1.3 时间戳笔记 actions 实现 --------
  setEpisodeStamps: async (id, season, episode, stamps) => {
    const book = await api.books.episodeSetStamps(id, season, episode, stamps)
    upsertBook(set, book)
    return book
  }
}))
