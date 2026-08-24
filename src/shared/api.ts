import type { Book, BookInput, Config, Edge } from './types'

export interface BrokenEntry {
  id: string
  error: string
}

export interface BookAPI {
  list(): Promise<{ books: Book[]; broken: BrokenEntry[] }>
  get(id: string): Promise<Book | null>
  create(input: BookInput): Promise<Book>
  update(id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[] }): Promise<Book>
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
