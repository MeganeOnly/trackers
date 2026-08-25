// 下位书籍追踪器 —— 共享类型定义

/** 书的阅读状态 */
export type BookStatus =
  | 'want' // 想看
  | 'shelved' // 搁置
  | 'reading' // 在读
  | 'finished' // 已读
  | 'abandoned' // 弃读

/** 创建/编辑输入：用户填的字段，不含 id/created/updated/read_count/tags 默认值 */
export type BookInput = Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags'> & {
  tags?: string[]
}

/** 阅读进度（用于连载小说等带"第 N / 总 M 章"的场景） */
export interface Progress {
  /** 当前已读到的章节数（≥1） */
  current: number
  /** 总章节数；null = 连载中/未知 */
  total: number | null
}

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
  /**
   * 章节进度；典型用于 status === 'reading' 的连载小说。
   * 未设置（null/undefined）= 没有进度记录。允许 status 切换时保留旧值以便续读。
   */
  progress: Progress | null
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
