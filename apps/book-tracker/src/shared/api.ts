import type { Book, BookInput, Config, Edge, PairwiseResult, RankingFile } from './types'

export interface BrokenEntry {
  id: string
  error: string
}

export interface BookAPI {
  list(): Promise<{ books: Book[]; broken: BrokenEntry[] }>
  get(id: string): Promise<Book | null>
  create(input: BookInput): Promise<Book>
  update(id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[]; progress?: BookInput['progress']; notes?: string }): Promise<Book>
  /**
   * 快速调整进度：`delta` 为 +1/+5 时递增 current；为 -1/-5 时递减（不低于 0）；
   * 当前没有 progress 时初始化为 { current: max(delta,1), total: null }。
   */
  progressBump(id: string, delta: number): Promise<Book>
  delete(id: string): Promise<void>
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
