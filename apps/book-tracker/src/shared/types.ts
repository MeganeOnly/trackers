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
  BrokenEntry,
  PairwiseResult,
  RankingFile
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

/**
 * 作品的阅读/观看状态
 * - `want` 想看 / `shelved` 搁置 / `finished` 已看完 / `abandoned` 弃看
 * - `reading` 在读（默认;适用全部类型）
 * - `watching` 在看（可选;仅非电影类型在表单中暴露。语义与 `reading` 一致,
 *   标签按作品类型更自然 —— 解决"看完后再看一遍"时 `reading`（在读）措辞尴尬的问题）
 */
export type BookStatus =
  | 'want' // 想看
  | 'shelved' // 搁置
  | 'reading' // 在读
  | 'watching' // 在看（仅非电影类型可选）
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
  /** 第 N 次读；仅 status 是「进行中」(reading/watching) 时有意义 */
  read_count: number
  /**
   * 章节进度；典型用于 status 是「进行中」时的连载作品。
   * 未设置（null/undefined）= 没有进度记录。允许 status 切换时保留旧值以便续读。
   */
  progress: Progress | null
  /**
   * 编辑模式侧栏收起：所有 status 都允许；从 EditMode 侧栏的 status 分组里移到
   * 底部『已收起』分组，纯展示层，不影响 status / 解锁 / CleanMode 任何行为。
   * book-tracker 原 CleanMode 只有 status-based 的折叠区（搁置/已读/弃读），
   * 加上本字段后 EditMode 侧栏新增一个跨 status 的『已收起』分组。
   */
  collapsed: boolean
  /** ISO 8601 字符串 */
  created: string
  /** ISO 8601 字符串 */
  updated: string
  tags: string[]
  /**
   * 用户笔记（自由写）。存在 frontmatter `notes` 字段里，v1 渲染策略:
   * - 详情页 / 加作品表单用 `<textarea>` 直接编辑,不做 Markdown 渲染
   * - 空串 = 无笔记（不写盘,避免污染 frontmatter）
   * - 字段缺损 / 老文件 → 空串（向后兼容;不会迁移 body 旧文本到 notes）
   */
  notes: string
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
