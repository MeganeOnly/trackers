import type { Book, BookInput, Candidate, CandidatesFile, Character, Config, Edge, PairwiseResult, PromoteStatus, RankingFile, SeasonInfo, Series, SeriesInput, SeriesPatch, TimeStamp } from './types'
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
  // -------- v1.6 「下一季」 --------
  /**
   * 设置 / 清除「下一季」关联到另一部作品(v1.6 新增;仅 tv/anime 实际使用)。
   * - `nextSeasonId: null` 或 `""` → 清空(不写 frontmatter)
   * - 禁止 id 跟 nextSeasonId 相同(self-loop,Rust 端拒绝)
   * - 目标 book 不存在时不拒绝(Rust 端不校验),由前端 UI 兜底提示「原作品已删除」
   */
  setNextSeason(id: string, nextSeasonId: string | null): Promise<Book>
  // -------- v2.x 「上一季」主动设置 --------
  /**
   * 设置 / 清除「上一季」关联到另一部作品(v2.x 新增;用户主动设,与 setNextSeason 的自动同步配对)。
   *
   * **与 setNextSeason 关键区别**:
   * - **单向写**:不联动 prev 目标书的 `nextSeasonId`(用户主动表达"我的上一季是 X"
   *   是一厢情愿,是否要 X.next = A 留给 X 自己决定)
   * - **粘性**:设值时同步写 `prevSeasonExplicit = true`;`setNextSeason` 反向清理路径
   *   看到该标记会跳过 —— 保护用户显式表达不被 service 层擅自覆盖
   * - `prevSeasonId: null` 或 `""` → 清空(不写 frontmatter,且 `prevSeasonExplicit` 重置为 false)
   *
   * 校验:禁止 self-loop;目标 book 不存在时仍写盘(同 setNextSeason 兜底)。
   */
  setPrevSeason(id: string, prevSeasonId: string | null): Promise<Book>
  // -------- v1.7 「所属系列」 --------
  /**
   * 设置 / 清除「所属系列」关联(v1.7 新增;无序收藏夹分组)。
   * - `seriesId: null` 或 `""` → 清空(不写 frontmatter)
   * - 目标 series 不存在时不拒绝(Rust 端不校验),由前端 UI 兜底提示「该系列已删除」
   *   (跟 setNextSeason 同款精神)
   * - **不走 update()**:关联字段走专用命令(便于将来加校验 / 系列删除时的反向引用清理)
   */
  setSeries(id: string, seriesId: string | null): Promise<Book>
  // -------- v2.x 顶层时间戳笔记 --------
  /**
   * 整段替换作品的顶层 `stamps` 数组(v2.x 新增;目前仅 movie 实际使用)。
   *
   * 与 `episodeSetStamps` 的关键区别:
   * - 作用于 **Book 顶层**(不分集);movie 没 episodes 结构,只能用本命令
   * - tv/anime 通常用 episodeSetStamps(粒度更细到集)
   * - book / other:本命令在 IPC 层可用,但 UI 暂未暴露
   *
   * - `stamps: []` → 清空所有顶层 stamp(整段不写 frontmatter)
   * - `stamps: [...]` → 整体替换;服务端按 start 升序重新排序
   *   (同 start 按 id 字典序;与前端 `sortStamps` 同步)
   * - `lastModified`(毫秒;可选)保留以对齐 `episodeSetStamps` API;
   *   单 stamp 自带 per-row `lastModified`,book 层不刷顶层时间戳
   * - **不联动 `book.updated`**:与 EpisodeRecord.stamps 同款语义
   *   (stamps 自带 per-row 时间戳,parent 时间戳不该被 stamps 改动触发)
   *
   * 设计:与 `episodeSetStamps` 同款「前端组合 + 服务端整段写」模型
   * (读 list → 改 → 整体传过来;服务端兜底排序)。
   */
  setStamps(id: string, stamps: TimeStamp[], lastModified?: number): Promise<Book>
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

/**
 * v1.7 系列 API。
 *
 * - `list()` 返回按 id 升序的所有 series
 * - `get(id)` 读单个 series(id 不存在 → null)
 * - `create(input)` 创建(name 必填,空串 → Rust 端 Err → JS 异常)
 * - `update(id, patch)` 更新(name 设为空 → Rust 端 Err;notes 空串显式清空)
 * - `delete(id)` 删除(联动清理所有 books 的 seriesId 引用,跟 deleteBook 清理 nextSeasonId 同款)
 */
export interface SeriesAPI {
  list(): Promise<Series[]>
  get(id: string): Promise<Series | null>
  create(input: SeriesInput): Promise<Series>
  update(id: string, patch: SeriesPatch): Promise<Series>
  delete(id: string): Promise<void>
}

/**
 * v2.x 候选剧集 API。
 *
 * - `list()` 返回所有候选（按 addedAt 倒序）
 * - `add(title, tags, note?)` 新增。同 title 不重复加（service 层去重，返回已有）
 * - `remove(id)` 删除
 * - `promote(id, status)` 把候选转为 books 条目（kind='tv'），完成后从 candidates 删除；
 *   返回新建的 Book。country/year/author 等元数据由用户后续在 book-tracker 补全
 */
export interface CandidatesAPI {
  list(): Promise<Candidate[]>
  add(title: string, tags: string[], note?: string): Promise<Candidate>
  remove(id: string): Promise<void>
  promote(id: string, status: PromoteStatus): Promise<Book>
}

export interface ElectronAPI {
  books: BookAPI
  relations: RelationsAPI
  config: ConfigAPI
  ranking: RankingAPI
  series: SeriesAPI
  candidates: CandidatesAPI
  data: DataAPI
}
