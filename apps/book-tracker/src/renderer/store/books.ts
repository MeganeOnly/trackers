import { create } from 'zustand'
import { api } from '../lib/api'
import type { Book, BookInput, Character, SeasonInfo, TimeStamp } from '@shared/types'

interface BooksState {
  books: Book[]
  broken: { id: string; error: string }[]
  selectedId: string | null
  loading: boolean
  // v1.7 wikilink —— 跨组件"跳转到角色"用 store 字段携带 bookId + characterId,
  // 让 CharactersPanel 能监听并自动展开目标角色(本地 useState 改不了跨组件的值)。
  // 语义:`{ bookId, characterId }` 同时定位"哪本书的哪个 character"。
  // 只在 WikilinkContext 跳转路径设置;CharactersPanel 内部点击展开仍走本地 useState。
  navigateToCharacter: { bookId: string; characterId: string } | null
  load: () => Promise<void>
  select: (id: string | null) => void
  create: (input: BookInput) => Promise<Book>
  update: (id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[]; progress?: BookInput['progress']; notes?: string; starring?: string; screenwriter?: string; seasons?: SeasonInfo[] }) => Promise<Book>
  bumpProgress: (id: string, delta: number) => Promise<Book>
  remove: (id: string) => Promise<void>
  // -------- v1.7 wikilink actions --------
  /** 让 CharactersPanel 自动展开指定 character(bookId 用于跨作品跳转后定位)。
   *  CharactersPanel 监听此字段,匹配 bookId 时把 expandedId 设到 characterId,
   *  再用 useEffect 把 navigateToCharacter 清回 null(避免二次触发死循环)。 */
  setNavigateToCharacter: (target: { bookId: string; characterId: string } | null) => void
  // -------- v1.2 集笔记 actions --------
  /** 整段替换季信息。`seasons: []` 等同清空 */
  setSeasons: (id: string, seasons: SeasonInfo[]) => Promise<Book>
  /** 切换单集 watched —— v1.5 不刷 lastModified(用户期望"什么都没改,老时间不变") */
  setEpisodeWatched: (id: string, season: number, episode: number, watched: boolean) => Promise<Book>
  /**
   * 设置单集笔记;空串 → 删 key。
   * `lastModified`(毫秒;可选)为 Some(非 0)且 note 非空时刷该集 lastModified;
   * 走"前端主动填 Date.now()"模式 —— store 层不主动 inject,组件自己决定。
   */
  setEpisodeNote: (id: string, season: number, episode: number, note: string, lastModified?: number) => Promise<Book>
  /**
   * 设置单集标题;空串 → 删 title 字段。
   * `lastModified`(毫秒;可选)为 Some(非 0)且 title 非空时刷。
   */
  setEpisodeTitle: (id: string, season: number, episode: number, title: string, lastModified?: number) => Promise<Book>
  /** 清空整部剧所有 episodes */
  clearEpisodes: (id: string) => Promise<Book>
  /** 进度 +1/-1 联动集笔记 */
  episodeBump: (id: string, delta: number) => Promise<Book>
  // -------- v1.3 时间戳笔记 actions --------
  /**
   * 整体替换单集的时间戳笔记数组。
   * - `stamps: []` → 清空该集所有 stamp(若该集也没其他字段则删 key);不刷 lastModified
   * - `stamps: [...]` → 整体替换;前端可按需先合并 + 排序,服务端会再次排序兜底;
   *   `lastModified`(毫秒;可选)为 Some(非 0)时刷该集 lastModified
   */
  setEpisodeStamps: (id: string, season: number, episode: number, stamps: TimeStamp[], lastModified?: number) => Promise<Book>
  // -------- v1.5 角色笔记 actions --------
  /**
   * 整段替换角色笔记数组。`characters: []` 等同清空。
   * 组件在 add/edit/remove character 时构造新数组(只对"用户主动改的"那条刷 lastModified),
   * store 层不主动 inject 时间戳 —— 见 CharactersPanel 的处理。
   */
  setCharacters: (id: string, characters: Character[]) => Promise<Book>
  // -------- v1.6 「下一季」actions --------
  /**
   * 设置 / 清除「下一季」关联到另一部作品(v1.6 新增;仅 tv/anime 实际使用)。
   * - `nextSeasonId: null` 或 `""` → 清空
   * - self-loop 在 Rust 端拒绝(id === nextSeasonId → IPC throw)
   * - 目标 book 不存在不拒绝,前端 UI 兜底提示「原作品已删除」
   */
  setNextSeason: (id: string, nextSeasonId: string | null) => Promise<Book>
  // -------- v2.x 「上一季」主动设 actions --------
  /**
   * 设置 / 清除「上一季」关联到另一部作品(v2.x 新增;用户主动设)。
   *
   * **与 setNextSeason 关键区别**:
   * - 单向写 —— 不联动 prev 目标书的 `nextSeasonId`
   * - 粘性 —— 设值时 Rust 端同步写 `prevSeasonExplicit = true`;后续
   *   `setNextSeason` 反向清理路径会跳过该 prev,保护用户显式表达
   *
   * 校验:self-loop Rust 端拒绝;目标不存在不拒绝(同 setNextSeason)。
   */
  setPrevSeason: (id: string, prevSeasonId: string | null) => Promise<Book>
  // -------- v1.7 「所属系列」actions --------
  /**
   * 设置 / 清除「所属系列」(v1.7 新增;无序收藏夹分组)。
   * - `seriesId: null` 或 `""` → 清空
   * - 目标 series 不存在不拒绝(Rust 端不校验),前端 UI 兜底提示「该系列已删除」
   *   (跟 setNextSeason 同款精神)
   * - 走专用 IPC `books_set_series`(跟 setNextSeason 同款;不进 update() patch 路径)
   */
  setSeries: (id: string, seriesId: string | null) => Promise<Book>
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
  // v1.7 wikilink —— 初始 null;跳转时由 WikilinkContext 写入,
  // CharactersPanel useEffect 消费完立即清回 null
  navigateToCharacter: null,
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
  setEpisodeNote: async (id, season, episode, note, lastModified) => {
    const book = await api.books.episodeSetNote(id, season, episode, note, lastModified)
    upsertBook(set, book)
    return book
  },
  setEpisodeTitle: async (id, season, episode, title, lastModified) => {
    const book = await api.books.episodeSetTitle(id, season, episode, title, lastModified)
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
  setEpisodeStamps: async (id, season, episode, stamps, lastModified) => {
    const book = await api.books.episodeSetStamps(id, season, episode, stamps, lastModified)
    upsertBook(set, book)
    return book
  },
  // -------- v1.5 角色笔记 actions 实现 --------
  setCharacters: async (id, characters) => {
    const book = await api.books.charactersSet(id, characters)
    upsertBook(set, book)
    return book
  },
  // -------- v1.6 「下一季」actions 实现 --------
  setNextSeason: async (id, nextSeasonId) => {
    const book = await api.books.setNextSeason(id, nextSeasonId)
    upsertBook(set, book)
    return book
  },
  // -------- v2.x 「上一季」主动设 actions 实现 --------
  setPrevSeason: async (id, prevSeasonId) => {
    const book = await api.books.setPrevSeason(id, prevSeasonId)
    upsertBook(set, book)
    return book
  },
  // -------- v1.7 「所属系列」actions 实现 --------
  setSeries: async (id, seriesId) => {
    const book = await api.books.setSeries(id, seriesId)
    upsertBook(set, book)
    return book
  },
  // -------- v1.7 wikilink actions 实现 --------
  setNavigateToCharacter: (target) => set({ navigateToCharacter: target })
}))
