// 下位书籍追踪器 —— 共享类型定义

/** 书的阅读状态 */
export type BookStatus =
  | 'want' // 想看
  | 'shelved' // 搁置
  | 'reading' // 在读
  | 'finished' // 已读
  | 'abandoned' // 弃读

/** 一本书 */
export interface Book {
  id: string
  title: string
  author: string
  country: string
  year: number
  translator: string
  status: BookStatus
  /** 第 N 次读；仅 status === 'reading' 时有意义 */
  read_count: number
  /** ISO 8601 字符串 */
  created: string
  /** ISO 8601 字符串 */
  updated: string
  tags: string[]
}

/** 解锁规则 */
export type UnlockRule = 'all' | 'any_of'

/** 一条前置边 */
export interface Edge {
  to: string
  prerequisites: string[]
  rule: UnlockRule
  /** 仅 rule === 'any_of' 时使用 */
  threshold?: number
}

/** relations.json 文件结构 */
export interface RelationsFile {
  version: number
  edges: Edge[]
}

/** 配置文件 */
export interface Config {
  version: number
  /** 用户数据根目录 */
  data_dir: string
  language: 'zh-CN'
  default_mode: 'clean' | 'edit'
}

/** 解锁结果 */
export interface UnlockResult {
  /** id -> 是否解锁 */
  unlocked: Map<string, boolean>
  /** 循环依赖的书 id 列表（这些书不参与解锁计算） */
  cycles: string[][]
}

/** IPC 通道名常量 */
export const IPC = {
  booksList: 'books:list',
  booksGet: 'books:get',
  booksCreate: 'books:create',
  booksUpdate: 'books:update',
  booksDelete: 'books:delete',
  relationsGet: 'relations:get',
  relationsSet: 'relations:set',
  configGet: 'config:get',
  configSet: 'config:set',
  dataPickDir: 'data:pickDir',
  dataRevealInExplorer: 'data:revealInExplorer'
} as const
