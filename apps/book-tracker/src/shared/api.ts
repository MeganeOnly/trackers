import type { Book, BookInput, Character, Config, Edge, PairwiseResult, RankingFile, SeasonInfo, TimeStamp } from './types'
import type { EpisodeNotes } from './types'

export interface BrokenEntry {
  id: string
  error: string
}

export interface BookAPI {
  list(): Promise<{ books: Book[]; broken: BrokenEntry[] }>
  get(id: string): Promise<Book | null>
  create(input: BookInput): Promise<Book>
  update(id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[]; progress?: BookInput['progress']; notes?: string; starring?: string; screenwriter?: string; seasons?: SeasonInfo[] }): Promise<Book>
  /**
   * 快速调整进度：`delta` 为 +1/+5 时递增 current；为 -1/-5 时递减（不低于 0）；
   * 当前没有 progress 时初始化为 { current: max(delta,1), total: null }。
   */
  progressBump(id: string, delta: number): Promise<Book>
  delete(id: string): Promise<void>
  // -------- v1.2 集笔记 --------
  /** 整段替换季信息。`seasons: []` 等同清空 */
  seasonsSet(id: string, seasons: SeasonInfo[]): Promise<Book>
  /** 切换单集 watched;watched=true 时若 key 不存在则新建;false 时无字段则删 key */
  episodeSetWatched(id: string, season: number, episode: number, watched: boolean): Promise<Book>
  /**
   * 设置单集笔记;空串 → 删 key(最稀疏)。
   * `lastModified`(毫秒;可选)为 Some(非 0)且 note 非空时刷该集 lastModified;
   * watched toggle 不刷(走 episodeSetWatched)。
   */
  episodeSetNote(id: string, season: number, episode: number, note: string, lastModified?: number): Promise<Book>
  /**
   * 设置单集标题;空串 → 删 title 字段(若该集无字段则删 key)。
   * `lastModified`(毫秒;可选)为 Some(非 0)且 title 非空时刷。
   */
  episodeSetTitle(id: string, season: number, episode: number, title: string, lastModified?: number): Promise<Book>
  /** 清空整部剧的所有 episodes */
  episodesClear(id: string): Promise<Book>
  /** 进度 +1/-1 联动集笔记;`delta > 0` 时把接下来的集标 watched */
  episodeBump(id: string, delta: number): Promise<Book>
  // -------- v1.3 时间戳笔记 --------
  /**
   * 整体替换单集的时间戳笔记数组。
   * - `stamps: []` → 清空该集所有 stamp(若该集也没其他字段则删 key);不刷 lastModified
   * - `stamps: [...]` → 整体替换;服务端按 start 升序重新排序;
   *   `lastModified`(毫秒;可选)为 Some(非 0)时刷该集 lastModified
   *
   * 设计：单条 stamp 的 add / edit / delete 由前端组合(读 list → 改 → 整体传过来),
   * 服务端只做"读 → 改 → 写"三步。简单、可证、可恢复(整段替换 + 服务端兜底排序)。
   */
  episodeSetStamps(id: string, season: number, episode: number, stamps: TimeStamp[], lastModified?: number): Promise<Book>
  // -------- v1.5 角色笔记 --------
  /** 整段替换角色笔记数组。`characters: []` 等同清空;稀疏写盘策略同 EpisodeRecord */
  charactersSet(id: string, characters: Character[]): Promise<Book>
}

export interface RelationsAPI {
  get(): Promise<Edge[]>
  set(edges: Edge[]): Promise<void>
}

export interface ConfigAPI {
  get(): Promise<Config>
  set(patch: Partial<Config>): Promise<Config>
}

/**
 * 两两对比排名 API。
 *
 * - `get()` 读 rankings.json（缺失返回默认空文件）
 * - `apply()` 追加一次结果，服务端覆盖 ts 后写回整文件，返回写后的 RankingFile；
 *   前端用本地 books 池 + 新 history 重算评分
 */
export interface RankingAPI {
  get(): Promise<RankingFile>
  apply(result: Pick<PairwiseResult, 'a' | 'b' | 'winner'>): Promise<RankingFile>
}

export interface DataAPI {
  pickDir(): Promise<string | null>
  revealInExplorer(): Promise<void>
}

export interface ElectronAPI {
  books: BookAPI
  relations: RelationsAPI
  config: ConfigAPI
  ranking: RankingAPI
  data: DataAPI
}
