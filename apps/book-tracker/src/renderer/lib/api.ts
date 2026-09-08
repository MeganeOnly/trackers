// Tauri renderer API shim —— 1:1 桥接 src-tauri/src/commands.rs 的 #[tauri::command].
//
// 与 src/shared/api.ts 的 ElectronAPI 形状一致,这样 renderer 代码切换时
// 调用点形态不变(只把 `window.electron.x.y` 换成 `api.x.y`)。
//
// 额外多了 `app.ensureDataDir()`,对应 src-tauri/src/lib.rs 里的
// `app_ensure_data_dir` 命令 —— 给首启 picker 流程用:
//   1. api.app.ensureDataDir()    → 已有则返回;没有则抛错
//   2. catch → api.data.pickDir()  → 用户选/取消
//   3. 成功后再 api.config.get() / api.books.list() / api.relations.get()
//
// invoke 参数约定(Tauri 2 默认):单个对象,key 用 snake_case,匹配 Rust 函数形参名.

import { invoke } from '@tauri-apps/api/core'
import type { Book, BookInput, Candidate, Character, Config, Edge, PromoteStatus, RankingFile, Series, SeriesInput, SeriesPatch, TimeStamp } from '@shared/types'
import type { BrokenEntry, ElectronAPI } from '@shared/api'

export const api: ElectronAPI = {
  books: {
    list: () => invoke<{ books: Book[]; broken: BrokenEntry[] }>('books_list'),
    get: (id) => invoke<Book | null>('books_get', { id }),
    create: (input) => invoke<Book>('books_create', { input }),
    update: (id, patch) => invoke<Book>('books_update', { id, patch }),
    progressBump: (id, delta) => invoke<Book>('books_progress_bump', { id, delta }),
    delete: (id) => invoke<void>('books_delete', { id }),
    // v1.2 集笔记
    seasonsSet: (id, seasons) => invoke<Book>('books_seasons_set', { id, seasons }),
    episodeSetWatched: (id, season, episode, watched) =>
      invoke<Book>('books_episode_set_watched', { id, season, episode, watched }),
    episodeSetNote: (id, season, episode, note, lastModified) =>
      invoke<Book>('books_episode_set_note', { id, season, episode, note, lastModified }),
    episodeSetTitle: (id, season, episode, title, lastModified) =>
      invoke<Book>('books_episode_set_title', { id, season, episode, title, lastModified }),
    episodesClear: (id) => invoke<Book>('books_episodes_clear', { id }),
    episodeBump: (id, delta) => invoke<Book>('books_episode_bump', { id, delta }),
    // v1.3 时间戳笔记
    episodeSetStamps: (id, season, episode, stamps, lastModified) =>
      invoke<Book>('books_episode_set_stamps', { id, season, episode, stamps, lastModified }),
    // v1.5 角色笔记
    charactersSet: (id, characters) => invoke<Book>('books_characters_set', { id, characters }),
    // v1.6 「下一季」
    setNextSeason: (id, nextSeasonId) =>
      invoke<Book>('books_set_next_season', { id, nextSeasonId }),
    // v2.x 「上一季」主动设
    setPrevSeason: (id, prevSeasonId) =>
      invoke<Book>('books_set_prev_season', { id, prevSeasonId }),
    // v1.7 「所属系列」
    setSeries: (id, seriesId) =>
      invoke<Book>('books_set_series', { id, seriesId }),
    // v2.x 顶层 stamps(movie 实际使用;其他类型预留)
    setStamps: (id, stamps, lastModified) =>
      invoke<Book>('books_set_stamps', { id, stamps, lastModified })
  },
  relations: {
    get: () => invoke<Edge[]>('relations_get'),
    set: (edges) => invoke<void>('relations_set', { edges })
  },
  config: {
    get: () => invoke<Config>('config_get'),
    set: (patch) => invoke<Config>('config_set', { patch })
  },
  ranking: {
    get: () => invoke<RankingFile>('ranking_get'),
    apply: (result) => invoke<RankingFile>('ranking_apply', { result })
  },
  series: {
    list: () => invoke<Series[]>('series_list'),
    get: (id) => invoke<Series | null>('series_get', { id }),
    create: (input) => invoke<Series>('series_create', { input }),
    update: (id, patch) => invoke<Series>('series_update', { id, patch }),
    delete: (id) => invoke<void>('series_delete', { id })
  },
  candidates: {
    list: () => invoke<Candidate[]>('candidates_list'),
    add: (title, tags, note) =>
      invoke<Candidate>('candidates_add', { title, tags, note: note ?? null }),
    remove: (id) => invoke<void>('candidates_remove', { id }),
    promote: (id, status) => invoke<Book>('candidates_promote', { id, status })
  },
  data: {
    pickDir: () => invoke<string | null>('data_pick_dir'),
    revealInExplorer: () => invoke<void>('data_reveal_in_explorer')
  },
  app: {
    ensureDataDir: () => invoke<string>('app_ensure_data_dir'),
    /**
     * 打开 / 聚焦「集笔记便签」独立小窗。
     * - 不存在 → Rust 端创建 webview window,加载 `index.html#/sticky` 路由
     * - 已存在 → Rust 端 unminimize + set_focus,**不**重建
     *   (避免丢失 React state / zustand store hydrate 状态)
     */
    openStickyWindow: () => invoke<void>('open_sticky_window')
  }
}
