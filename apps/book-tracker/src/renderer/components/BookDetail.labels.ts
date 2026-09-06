// 作品类型感知的字段标签 + 状态文案
//
// 集中维护详情页 / 加作品表单 两处共用的 label 字典,
// 避免 inline switch 散落各处。BookFormFields 端是另一份就近副本
// (共享到 @shared 段成本不划算, 共享判定:领域专属 UI 标签)。
//
// 类型感知:同一份表单套 5 种作品类型 (book / anime / tv / movie / other) 时,
// 作者 / 年份 / 国家的语义不同 (书→出版年份, 影视→首播/上映年份,
// 书→原产国, 影视→制片国家)。用纯函数 kindLabelXxx(kind) 集中维护。

import type { BookStatus, WorkKind } from '@shared/types'

/** 状态显示名(详情页 / 卡片 / 选项 / 关系图 共享) */
export const STATUS_LABELS: Record<BookStatus, string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  watching: '在看',
  finished: '已读',
  abandoned: '弃读'
}

/**
 * 侧栏分组顺序 —— 「进行中」(reading / watching) 排最前,
 * watching 紧接 reading 便于一眼看到同类目。
 * 关系图 (GraphView) 用自己的视觉优先级(已读优先),不共用。
 */
export const SIDEBAR_STATUS_ORDER: BookStatus[] = [
  'reading',
  'watching',
  'want',
  'finished',
  'shelved',
  'abandoned'
]

/** status 下拉选项基表(movies 用; 跟 form 共享) */
const STATUS_BASE_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: 'want', label: '想看' },
  { value: 'shelved', label: '搁置' },
  { value: 'reading', label: '在读' },
  { value: 'finished', label: '已读' },
  { value: 'abandoned', label: '弃读' }
]

/** 在看(watching)仅对非电影类型暴露 */
export function statusOptionsFor(kind: WorkKind): { value: BookStatus; label: string }[] {
  if (kind === 'movie') return STATUS_BASE_OPTIONS
  return [
    ...STATUS_BASE_OPTIONS.slice(0, 3),
    { value: 'watching', label: '在看' },
    ...STATUS_BASE_OPTIONS.slice(3)
  ]
}

/** 作品类型感知的「作者」字段标签 */
export function authorLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'anime': return '原作 / 主创'
    case 'tv': return '原作 / 主创'
    case 'movie': return '导演'
    case 'other': return '作者 / 主创'
    case 'book': return '作者'
  }
}

/** 「译者」仅 book 显示 */
export function translatorLabelFor(kind: WorkKind): string | null {
  return kind === 'book' ? '译者' : null
}

/** 「主演」仅 movie / tv 显示 */
export function starringLabelFor(kind: WorkKind): string | null {
  return kind === 'movie' || kind === 'tv' ? '主演' : null
}

/** 「编剧」仅 movie / tv 显示 */
export function screenwriterLabelFor(kind: WorkKind): string | null {
  return kind === 'movie' || kind === 'tv' ? '编剧' : null
}

/** 作品类型感知的「年份」字段标签 */
export function yearLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'book': return '出版年份'
    case 'anime': return '开始年份'
    case 'tv': return '首播年份'
    case 'movie': return '上映年份'
    case 'other': return '年份'
  }
}

/** 作品类型感知的「国家」字段标签 */
export function countryLabelFor(kind: WorkKind): string {
  return kind === 'book' ? '原产国 / 地区' : '制片国家 / 地区'
}
