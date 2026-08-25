import type { Book, BookInput, Config, Edge } from './types'

export interface BrokenEntry {
  id: string
  error: string
}

export interface BookAPI {
  list(): Promise<{ books: Book[]; broken: BrokenEntry[] }>
  get(id: string): Promise<Book | null>
  create(input: BookInput): Promise<Book>
  update(id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[]; progress?: BookInput['progress'] }): Promise<Book>
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

export interface DataAPI {
  pickDir(): Promise<string | null>
  revealInExplorer(): Promise<void>
}

export interface ElectronAPI {
  books: BookAPI
  relations: RelationsAPI
  config: ConfigAPI
  data: DataAPI
}
