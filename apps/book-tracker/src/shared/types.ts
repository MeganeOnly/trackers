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
 * 单季元信息 —— 仅在 `kind === 'tv' | 'anime'` 时有意义。
 * 用 `number` 区分季号（1-based），`episodeCount` 记录该季总集数。
 * 季笔记（`notes`）是 v1.2 新增：用于"这一季整体评价 / 节奏总结"，与单集 `EpisodeRecord.note` 不同。
 */
export interface SeasonInfo {
  /** 季号（1-based；S01 = 1, S02 = 2 ...） */
  number: number
  /** 该季总集数 */
  episodeCount: number
  /** 该季整体笔记（可选；空串不写盘） */
  notes?: string
}

/**
 * 单集记录 —— 出现在 `Book.episodes` 稀疏 map 里。
 * 字段均为可选 + 稀疏：watched=true 的集 / 有 note 的集 / 有 title 的集才占 key。
 * `title`（集标题，如"改稻为桑"）是 v1.2 新增：用户在详情页展开该集时可填，
 * 网格里只显示集号 + 状态图标（不显示标题），与现状"格子极简、详情深入"一致。
 */
export interface EpisodeRecord {
  /** 是否已看 —— 默认 false;允许乱序(跳过 / 重看) */
  watched: boolean
  /** 该集笔记;空串 → 删 key（决策 4 = 最稀疏） */
  note: string
  /** 该集标题（可选；空串 → 不写字段） */
  title?: string
}

/** 单集稀疏 map —— key = `${season}-${episode}` 字符串
 *  例: "1-3" = S01E03, "2-10" = S02E10 */
export type EpisodeNotes = Record<string, EpisodeRecord>

/** 把 season + episode 拼成 EpisodeNotes key。 */
export function episodeKey(season: number, episode: number): string {
  return `${season}-${episode}`
}

/** 把 EpisodeNotes key 拆回 {season, episode}。拆分失败 → null（防御非法 key）。 */
export function parseEpisodeKey(key: string): { season: number; episode: number } | null {
  const idx = key.indexOf('-')
  if (idx <= 0 || idx >= key.length - 1) return null
  const s = Number(key.slice(0, idx))
  const e = Number(key.slice(idx + 1))
  if (!Number.isInteger(s) || s < 1 || !Number.isInteger(e) || e < 1) return null
  return { season: s, episode: e }
}

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

/** 创建/编辑输入：用户填的字段，不含 id/created/updated/read_count/tags 默认值；
 *  `episodes` 也不在 BookInput 里 —— 单集笔记是详情页独占编辑的，不在加作品表单出现。
 *  `seasons` 保留在 BookInput（季结构是创建作品时确定的）。 */
export type BookInput = Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags' | 'episodes'> & {
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
  /**
   * 主演(影视专用)。仅 `kind === 'movie' | 'tv'` 时在 UI 表单暴露（位置与书的"译者"对称）——
   * 解决"电影 / 电视剧 也需要一个主要贡献者字段"的诉求。
   * 存储策略同 `notes` / `translator`:空串不写盘,老文件缺字段 → 空串(向后兼容)。
   */
  starring: string
  /**
   * 编剧(影视专用)。仅 `kind === 'movie' | 'tv'` 时在 UI 表单暴露 —— 与"主演"同属影视主创字段,
   * 但放在 form 上独立的 input 行(避免标签二义:"主演"指的是演员,"编剧"指的是剧本作者)。
   * 存储策略同 `starring` / `notes`:空串不写盘,老文件缺字段 → 空串(向后兼容)。
   */
  screenwriter: string
  /**
   * 季信息数组 —— 仅 `kind === 'tv' | 'anime'` 时有意义。
   * 缺省 / undefined 视为"单季剧",等同 `[{ number: 1, episodeCount: progress.total ?? 0 }]`。
   * 决策 B：季数中途变化时保留旧 episodes key（不自动清理超出范围的 key,用户手填新季集数即可）。
   * 写盘策略:空数组不写 frontmatter;老文件缺字段 → undefined(向后兼容)。
   */
  seasons?: SeasonInfo[]
  /**
   * 单集稀疏 map —— 仅 `kind === 'tv' | 'anime'` 时有意义。
   * key 用 `episodeKey(season, episode)` = `"${season}-${episode}"` 形式;
   * watched=true / 有 note / 有 title 的集才占 key（最稀疏策略）。
   * 写盘策略:空对象 / 全空 record 不写 frontmatter;老文件缺字段 → undefined。
   * 与 `progress.current` 解耦:progress 仍是"线性最高已看",但单集 watched 允许乱序。
   */
  episodes?: EpisodeNotes
}

/** 主题预设（视觉风格）：classic = 当前样式（保留）；library = 深森林绿书架风 */
export type ThemeName = 'classic' | 'library' | 'codex'

/** 格式预设（信息呈现方式）：与 theme 正交，组合成 9 种 preset
 * - list: 紧凑列表（默认；与 Classic 同款）
 * - grid: 卡片墙（CSS grid auto-fill）
 * - focus-stack: 焦点卡 + 紧凑清单 + 印章墙（按时间倒序） */
export type FormatName = 'list' | 'grid' | 'focus-stack'

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
  /** 视觉主题预设（不在 patch 里改 data_dir；theme 走 ConfigPatch.theme） */
  theme?: ThemeName
  /** 信息呈现格式（与 theme 正交,独立维度） */
  format?: FormatName
}
