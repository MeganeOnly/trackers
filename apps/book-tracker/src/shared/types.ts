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
 * `lastModified` 是 v1.5 新增：仅在 `notes` 字段被改时刷新（季号 / 集数变化不刷）。
 */
export interface SeasonInfo {
  /** 季号（1-based；S01 = 1, S02 = 2 ...） */
  number: number
  /** 该季总集数 */
  episodeCount: number
  /** 该季整体笔记（可选；空串不写盘） */
  notes?: string
  /** 该季笔记最后修改时间（毫秒；undefined 不写盘；v1.5 起） */
  lastModified?: number
}

/**
 * 单集时间戳笔记 —— 出现在 `EpisodeRecord.stamps` 数组里（v1.3 新增）。
 *
 * 用途：用户看剧时手动标"开始时间 [→ 结束时间] 描述"的片段笔记，
 * 例如 `00:32:15 - 00:35:40 高潮追车`。`end` 可选 —— 单时间点 = "这一刻"，
 * 时间段 = "这段场景"。
 *
 * 时间统一用**秒**存（避免 mm:ss/hh:mm:ss 在 UI 切换时反复解析、跨平台格式不一致）。
 * UI 输入框解析 `mm:ss` / `hh:mm:ss` / `ss` 三种人类格式，写入前转成秒；
 * 展示时再格式化为 `mm:ss` / `hh:mm:ss`，保证 Rust 端只面对纯数字。
 *
 * `id` 是稳定 UUID（`crypto.randomUUID()`），用于编辑 / 删除单条时定位；
 * 跟同条目的 sort 顺序无关 —— 后端读时按 `start` 升序排序后返回。
 *
 * 写盘策略：stamps 数组为空 → 不写字段（继承 EpisodeRecord 的"最稀疏"语义）。
 * 老数据缺字段 → undefined（向后兼容，`parse_stamps` 容错）。
 *
 * **`lastModified` 是 per-row 跟踪**（v1.6 修正）—— 每个 stamp 独立的"最后
 * 修改时间"，与 v1.5 `Character.lastModified` 同款语义。StampList 编辑单条
 * 时构造新数组，对被改的 stamp 刷 `lastModified = Date.now()`；其他 stamp
 * 原值保持。**与 `EpisodeRecord.lastModified` 解耦** —— 后者只反映该集
 * note / title 改动，不被 stamp 改动触发（避免"改了某条 stamp → 整个 episode
 * 的最后修改时间被刷新"的混淆）。
 */
export interface TimeStamp {
  /** 稳定 UUID —— 用于编辑 / 删除定位 */
  id: string
  /** 开始时间（秒;非负整数;0 允许表示"开场"） */
  start: number
  /** 结束时间（秒;可选 —— 单时间点 vs 时间段） */
  end?: number
  /** 笔记内容 */
  note: string
  /**
   * 该 stamp 最后修改时间（毫秒;可选;向后兼容老数据）——
   * 仅在该 stamp 的 start / end / note 任一被改时刷新;同一条 stamp 多次
   * 编辑时取最后一次时间戳。删除 stamp 不刷（条目已消失）。
   * 字段缺损 / 老文件缺字段 → undefined，UI 不显示时间戳。
   */
  lastModified?: number
}

/**
 * 把秒格式化成 `hh:mm:ss` 或 `mm:ss`（自动选短的）。
 * 用途：UI 列表里渲染 stamp 的开始/结束时间。
 */
export function formatStamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/**
 * 把人类格式时间字符串解析为秒。
 * 接受三种格式（首尾空白自动 trim）：
 * - `ss`         （秒;如 `45`）
 * - `mm:ss`      （分:秒;如 `12:34`）
 * - `hh:mm:ss`   （时:分:秒;如 `1:02:03`）
 *
 * 返回 `null` 表示解析失败（空串 / 非数字 / 非法范围如 60 秒位 / 负数）。
 * UI 用例：用户输入框失焦时校验 + 提示重输。
 */
export function parseStamp(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const parts = trimmed.split(':')
  if (parts.length < 1 || parts.length > 3) return null
  const nums: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    const n = Number(p)
    nums.push(n)
  }
  // 各段范围校验:最右段(秒)必须 < 60;中间段(分) < 60(只要 parts 长度 ≥ 2)
  // 最左段(时)无上限
  if (nums.length === 1) {
    // ss
    return nums[0]
  } else if (nums.length === 2) {
    // mm:ss
    if (nums[1] >= 60) return null
    return nums[0] * 60 + nums[1]
  } else {
    // hh:mm:ss
    if (nums[1] >= 60 || nums[2] >= 60) return null
    return nums[0] * 3600 + nums[1] * 60 + nums[2]
  }
}

/**
 * 把 stamps 数组按 start 升序排序(同 start 按 id 字典序,保证稳定排序)。
 * 纯函数 —— 前端展示 / 后端读回都调一次,渲染顺序稳定。
 */
export function sortStamps(stamps: ReadonlyArray<TimeStamp>): TimeStamp[] {
  return [...stamps].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return a.id.localeCompare(b.id)
  })
}

/**
 * 单集记录 —— 出现在 `Book.episodes` 稀疏 map 里。
 * 字段均为可选 + 稀疏：watched=true 的集 / 有 note 的集 / 有 title 的集才占 key。
 * `title`（集标题，如"改稻为桑"）是 v1.2 新增：用户在详情页展开该集时可填，
 * 网格里只显示集号 + 状态图标（不显示标题），与现状"格子极简、详情深入"一致。
 * `stamps`（时间戳笔记数组）是 v1.3 新增：用户在详情页展开该集时可逐条加 stamp；
 * 写盘策略同 `note`：空数组 → 不写字段。
 * `lastModified` 是 v1.5 新增：仅在 note / title / stamps 任一被改时刷新（v1.5 决策）;
 * 单纯 watched toggle 不刷 —— 用户期望"点进去但什么都没改,老时间不变"。
 */
export interface EpisodeRecord {
  /** 是否已看 —— 默认 false;允许乱序(跳过 / 重看) */
  watched: boolean
  /** 该集笔记;空串 → 删 key（决策 4 = 最稀疏） */
  note: string
  /** 该集标题（可选；空串 → 不写字段） */
  title?: string
  /**
   * 该集时间戳笔记数组（v1.3 新增）。空数组 / 全空 stamp 视为无 stamp，
   * 不写盘。展示时由 selector / 组件按 `start` 升序自动排序。
   */
  stamps?: TimeStamp[]
  /**
   * 该集笔记内容最后修改时间（毫秒;undefined 不写盘）;
   * 仅在 note / title / stamps 任一被用户改写时刷新;watched toggle 不刷新。
   * 字段缺损 → undefined（向后兼容;老数据无此字段）。
   */
  lastModified?: number
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
 * 角色笔记条目 —— 出现在 `Book.characters` 数组里（v1.5 新增）。
 *
 * 用途：用户对一部作品里的"角色"（人物 / 主角 / 配角 / 阵营 / 组织……）做独立笔记。
 * 例：电视剧里的"高育良"、书里的"贾宝玉"、电影里的"Neo"——都可以一条一条列出来单独写。
 *
 * 字段语义：
 * - `name` 必填；空字符串视为"脏数据",由 service 层在 IPC 时过滤掉(整条删除)
 * - `notes` 可选;空串不写 frontmatter(保留 character 实体,只是这一时刻没笔记)
 * - `lastModified` 仅在 `name` 或 `notes` 被用户改写时刷新(前端构造新数组时主动填);
 *   删除 character 时不需要带 lastModified
 *
 * 写盘策略(整体跟 EpisodeRecord 对齐):
 * - `characters` 数组为空 → 不写 frontmatter
 * - 单条 character 的 `name` 空 → 整条删除(由前端 IPC 前过滤)
 * - 单条 character 的 `notes` 空 → notes 字段不写,但保留 character 条目
 * - 单条 character 的 `lastModified` undefined → 不写字段
 * - 老数据缺 `characters` 字段 → undefined(向后兼容;`parse_characters` 容错)
 */
export interface Character {
  /** 稳定 UUID —— 用于编辑 / 删除定位(与 stamp 同款) */
  id: string
  /** 角色名（必填;空字符串视为待删除,IPC 前过滤掉） */
  name: string
  /** 角色笔记（可选;空串不写盘） */
  notes?: string
  /** 最后修改时间（毫秒;undefined 不写盘） */
  lastModified?: number
}

/** 角色笔记数组 —— 出现在 `Book.characters` */
export type CharacterNotes = Character[]

/** 把毫秒时间戳格式化成 `YYYY-MM-DD HH:MM`（本地时区）。UI 展示"上次修改"用。 */
export function formatLastModified(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 生成稳定 UUID;优先 `crypto.randomUUID()`(浏览器原生),降级到时间戳 + 随机数。 */
export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 0x10000).toString(16)}`
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
 *  `seasons` 保留在 BookInput（季结构是创建作品时确定的）。
 *  `characters` 也不在 BookInput 里 —— 角色笔记是详情页独占编辑的（v1.5 起）。 */
export type BookInput = Omit<Book, 'id' | 'created' | 'updated' | 'read_count' | 'tags' | 'episodes' | 'characters'> & {
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
  /**
   * 角色笔记数组（v1.5 新增）—— 所有类型都能用,不只是 tv/anime。
   * 例:书里的人物、电视剧角色、动画声优角色、电影主角、组织 / 阵营——都可以列出来单独写。
   * 写盘策略:空数组 / 全空 character 不写 frontmatter;老文件缺字段 → undefined。
   * 单条 character 内部:见 Character 的稀疏语义（notes 空 → 保留条目;name 空 → 删除条目）。
   */
  characters?: CharacterNotes
  /**
   * 「下一季」关联到另一部作品的 id（v1.6 新增;仅 tv/anime 实际使用,其他类型也允许但场景少见）。
   *
   * 语义:把这部作品的"下一季"指向另一部已存在的 book。典型场景:一部剧拆成多个 book 追踪
   * （S01 / S02 / S03+）时,把它们串起来形成连贯线索。
   *
   * **单向字段**;反向"谁的下季是本季"通过 `prevSeasonId` 直接读（v1.6 起双向同步,
   * 由 service 层在 setNextSeason 路径自动维护,前端不需要主动设 prevSeasonId）。
   *
   * 写盘策略:undefined / 空串 → 不写 frontmatter;老文件缺字段 → undefined（向后兼容）。
   * 跟 `notes` / `starring` / `screenwriter` 同款"空值不写盘"语义。
   *
   * 候选过滤（在 BookDetail 的 NextSeasonPicker 里实现）:
   * - 排除自己（self-loop 禁止）
   * - 推荐优先显示 tv / anime 类型,但不强约束（允许跨类型,如漫画 → 动画）
   */
  nextSeasonId?: string
  /**
   * 「上一季」关联到另一部作品的 id（v1.6 新增;与 `nextSeasonId` 配对）—— 反向引用。
   *
   * 语义:「这部作品的上一季是 `prevSeasonId` 那部 book」,等价于"那部 book 的下一季是我"。
   * 典型场景:一部剧拆成多个 book 追踪时,例如《鉴证实录 S02》有 prevSeasonId = S01 的 id,
   * 双向可点击跳转形成整条季链。
   *
   * **v1.6 起源**:由 service 层在 set_next_season 路径双向同步维护,前端不主动设。
   * **v2.x 扩展**:新增 `books_set_prev_season` IPC,允许用户主动设 prev(配合
   * `prevSeasonExplicit` 粘性标记)。主动设的 prev 即使 prev 目标书的 next 被改指向别处,
   * 也不会被 service 层反向清掉 —— 尊重用户显式表达"我的上一季就是 X"。
   *
   * 写盘策略:同 nextSeasonId —— undefined / 空串不写 frontmatter;老文件缺字段 → undefined。
   *
   * 例:A.nextSeasonId = B → A.prevSeasonId 还是 None,B.prevSeasonId 自动设为 A.id。
   * 反之亦然:把 A.nextSeasonId 从 B 改到 C 时,C.prevSeasonId 自动设为 A,B.prevSeasonId 自动清掉。
   */
  prevSeasonId?: string
  /**
   * 「上一季」是否用户主动设置(v2.x 新增;与 `prevSeasonId` 配对)。
   *
   * 区分两种 prev 来源:
   * - `true` —— 用户通过 BookDetail「上一季」picker 主动设的;`set_next_season`
   *   路径反向清 prev 时看到该标记会**跳过**(粘性保护),尊重用户显式表达
   * - `false`(默认)—— service 层在 set_next_season 路径自动同步产生的,
   *   可被反向清掉(老逻辑)
   *
   * 写盘策略:仅 `true` 写 frontmatter,`false` / `undefined` 不写(避免污染);
   * 老文件缺字段 → `undefined`(向后兼容)。
   *
   * IPC 字段名:跟 nextSeasonId / prevSeasonId 一致用单字段 `rename`(Rust 端实现),
   * TS 端直接 `book.prevSeasonExplicit` 访问。
   */
  prevSeasonExplicit?: boolean
  /**
   * 「所属系列」id(v1.7 新增;无序收藏夹分组)。
   *
   * 语义:这部作品属于 `seriesId` 这个 Series 集合(同一系列下可能有电视剧 / 电影 /
   * 原著小说 / 外传等多本作品)。**与 `nextSeasonId` 区分**:`nextSeasonId` 是
   * "线性季链"(A 的下一季是 B);`seriesId` 是"无序归组"(A 和 B 都属"大明王朝"
   * 系列但没有先后关系)。两者可以共存(A 既在"大明王朝"系列里,nextSeasonId
   * 又指向 S02)。
   *
   * **单向字段**:只有"作品 → 系列"方向;系列侧不维护"包含哪些作品"的反向引用
   * (renderer 端从 books 全量扫一遍聚合即可)。**没有自动双向同步**。
   *
   * 写盘策略:同 `nextSeasonId` —— 非空字符串才写 frontmatter,空串 / undefined
   * 不写;老文件缺字段 → undefined(向后兼容)。
   *
   * **不走 `BookPatch`**:改所属系列走专用 IPC `books_set_series`(跟
   * `books_set_next_season` 同款;关联字段走专用命令便于将来加校验 / 系列
   * 删除时的反向引用清理)。
   */
  seriesId?: string
}

// ==================== v2.x 候选剧集（Candidates）类型 ====================

/**
 * 候选剧集条目：用户感兴趣 / skill 推荐了但还没决定看的剧。
 * 与 Series（v1.7，无序归组）语义不同：
 * - Series 是"已确定归属的归组"
 * - Candidate 是"还没决定是否进入作品库的待选池"
 *
 * 数据存 `<data_dir>/candidates.json`，与 `books/` `series.json` 平级。
 *
 * 写盘策略：
 * - `tags` 空数组保留语义 = "暂无分类"
 * - `note` 空串不写盘
 * - 老数据缺字段 → undefined（向后兼容）
 */
export interface Candidate {
  id: string
  /** 剧名（必填；空串 → 拒绝创建） */
  title: string
  /** 分类标签（如 ["古装", "断案", "单元剧"]）—— 空数组保留语义 */
  tags: string[]
  /** 短注（可选；空串不写盘） */
  note?: string
  /** ISO 8601 字符串 */
  addedAt: string
}

/** candidates.json 文件结构 */
export interface CandidatesFile {
  version: 1
  items: Candidate[]
}

/** promote 操作的目标状态：'want' / 'finished' */
export type PromoteStatus = 'want' | 'finished'

// ==================== v1.7 系列（Series）类型 ====================

/**
 * 一个系列（v1.7 新增）—— 把多部相关作品归组（电视剧 + 衍生的电影 / 小说 / 外传等）。
 *
 * **设计取舍**:
 * + 系列本身**只承载元信息**(id / name / notes / 时间戳),成员关系存放在各 book
 *   的 `seriesId` 字段(单向引用)。renderer 端从 books 全量扫一遍聚合即可获得
 *   "某系列下所有作品",无需在 Series 实体里维护反向数组,避免双写一致性。
 * + **没有 `members` / `cover` / `description` 等额外字段**(v1.7 最小可用版);
 *   `notes` 字段允许用户写系列简介(空串 = "无简介")。后续若需要封面 / 成员顺序 /
 *   衍生分组,再加 v1.8 字段,不破坏现有数据(空缺字段 → undefined / 空)。
 *
 * **与 nextSeasonId 的区别**:`nextSeasonId` 是"线性季链"(有方向、有先后),
 * `seriesId` 是"无序归组"(只是收藏夹,无顺序、无方向)。两者共存不影响 —— A
 * 可以在某系列里,同时 nextSeasonId 指向 S02。
 *
 * 写盘策略(由 Rust 端 `data::series::write_series_file` 兜底):
 * + `name` 空串视为"无名称",**拒绝创建**(前端 IPC 前先校验;后端 service 层也兜底)
 * + `notes` 空串 → 不写 frontmatter(同 Book.notes 策略)
 * + 老数据缺字段 → undefined(向后兼容)
 */
export interface Series {
  id: string
  /** 系列名 —— 必填;前端校验非空 */
  name: string
  /** 系列简介 —— 可选;空串不写盘 */
  notes?: string
  /** 创建时间 ISO 8601 */
  created: string
  /** 更新时间 ISO 8601 */
  updated: string
}

/** 创建系列的用户输入 —— `name` 必填,`notes` 可选。 */
export interface SeriesInput {
  name: string
  notes?: string
}

/** 更新系列 patch(全字段可选)。`notes: ""` 用于显式清空。 */
export interface SeriesPatch {
  name?: string
  notes?: string
}

/** 主题预设（视觉风格）：classic = 当前样式（保留）；library = 深森林绿书架风 */
export type ThemeName = 'classic' | 'library' | 'codex'

/** 格式预设（信息呈现方式）：与 theme 正交，组合成 9 种 preset
 * - list: 紧凑列表（默认；与 Classic 同款）
 * - grid: 卡片墙（CSS grid auto-fill）
 * - focus-stack: 焦点卡 + 紧凑清单 + 印章墙（按时间倒序） */
export type FormatName = 'list' | 'grid' | 'focus-stack'

/**
 * 侧栏系列入口展示模式(v2.x 起)—— 编辑模式 BookList 里如何呈现 series。
 * - `inline-row`:系列徽章插入到 status 分组顶部,跨 status 可重复,搜索去重(默认)
 * - 后续可加 `side-section`(顶层独立 section)/ `chip-list`(每 series 一个 chip)等
 *
 * **跟 status 的关系**:徽章总是基于「该 status 下有多少本 book 属于该 series」展示,
 * 搜索时按系列名 + 成员名匹配去重,只在第一个匹配的 status 分组展示一次。
 */
export type SidebarSeriesEntryMode = 'inline-row'

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
  /**
   * 侧栏系列入口展示模式(v2.x 起)—— 当前固定 `inline-row`,预留扩展位。
   * 写盘:`Some('inline-row')` 才写,空串 / 未知值 fallback `inline-row`(同 theme / format 模式)。
   */
  sidebar_series_entry_mode?: SidebarSeriesEntryMode
  /**
   * 「字体加载」开关 —— 选 Fraunces 字体的加载来源(仅 library/codex 主题生效)。
   * - `true`:本地字体(下载到 packages/tracker-ui/src/fonts/ 的 ttf,offline 友好)
   * - `false`(默认):Google Fonts CDN(走 index.html 里的 <link>)
   *
   * **默认 `false` 与现状一字不动** —— 用户在 Settings → 「外观 · 字体加载」开 ON
   * 后,base.css 的 `[data-font-source="local"]` 选择器接管,@font-face 用本地 ttf。
   * Rust 端 ConfigPatch 同样镜像,白名单校验 + fallback false(老 config 缺字段)。
   */
  use_local_fonts?: boolean
  /**
   * 「柔化视觉」开关 —— 是否启用「柔化 token」组(圆角 / 阴影 +1)。
   * - `true`:radius-sm 2→3 / radius-md 4→6 / radius-lg 8→10,基座 --shadow-card 更柔
   * - `false`(默认):原 token 值,与现状一字不动
   *
   * 同样默认关闭。改的 token 数刻意控制在「边缘柔和、整体密度不变」,不动 spacing /
   * 字号 / 字体(动了破坏既有对齐)。由 Settings → 「外观 · 视觉舒适」开 ON。
   */
  use_cozy_tokens?: boolean
}
