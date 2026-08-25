// 下位书籍追踪器 —— Book 领域类型定义
//
// 通用类型（Edge / Progress / RelationsFile / UnlockResult / UnlockRule）已抽到
// monorepo 共享内核 `@core`（packages/tracker-core），本文件 re-export 保持
// 现有 `@shared/types` 引用不变；Book 领域类型留在这里。

export type {
  Edge,
  Progress,
  RelationsFile,
  UnlockResult,
  UnlockRule,
  BrokenEntry
} from '@core'

import type { Progress } from '@core'

/** 作品类型：不只书，还有动画 / 电视剧 / 电影 / 其他 */
export type WorkKind = 'book' | 'anime' | 'tv' | 'movie' | 'other'

export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  book: '书',
  anime: '动画',
  tv: '电视剧',
  movie: '电影',
  other: '其他'
}

export const WORK_KIND_ORDER: WorkKind[] = ['book', 'anime', 'tv', 'movie', 'other']

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

/** 一部作品（书 / 动画 / 电视剧 / 电影等） */
export interface Book {
  id: string
  title: string
  /** 作品类型 */
  kind: WorkKind
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

/** 配置文件（数据目录自带） */
export interface Config {
  version: number
  /** 用户数据根目录 */
  data_dir: string
  language: 'zh-CN'
  default_mode: 'clean' | 'edit'
  /** 新建作品的默认类型 */
  default_work_kind: WorkKind
  /** 展示筛选："all" 或某个 WorkKind */
  works_filter: string
}
