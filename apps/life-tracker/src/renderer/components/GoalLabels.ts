// life-tracker Goal 领域字典的统一出口
//
// 历史:STATUS_LABELS / STATUS_LABEL / STATUS_OPTIONS / STATUS_COLORS / STATUS_ORDER
// 散落在 5 个文件里(GoalDetail / GoalForm / GoalList / GraphView / PrereqEditor / CleanMode),
// 改一个字段名/新增一个 status 就要同步改 N 处,容易漏掉。
//
// 参照 book-tracker 的 BookDetail.labels.ts 模式(见 docs/dev-notes.md 2026-09 §v2.x):
// 「标签字典」抽到最前,跨文件 dedup 的入口。
//
// 命名约定:
// - STATUS_LABELS        status → 显示文案(7 处共用,统一一份)
// - STATUS_COLORS        status → 节点颜色(GraphView 用,集中维护)
// - STATUS_OPTIONS       status → 下拉选项 `{value, label}[]`(表单用,顺序与 SIDEBAR 顺序对齐)
// - SIDEBAR_STATUS_ORDER 侧栏分组顺序(`in_progress` 优先,跟 GraphView 的视觉优先相反)
// - GRAPH_STATUS_ORDER   关系图节点视觉优先级(`done` 优先,「已完成」放最显眼)

import type { GoalStatus } from '@shared/types'

/** status → 显示文案。所有 UI 共用这一份。 */
export const STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  done: '已达成',
  shelved: '搁置',
  abandoned: '放弃'
}

/** status → 节点颜色。GraphView 用,集中维护避免漏掉某个 status。 */
export const STATUS_COLORS: Record<GoalStatus, string> = {
  not_started: '#999999',
  in_progress: '#4a7c59',
  done: '#2d5a3a',
  shelved: '#c89456',
  abandoned: '#c0573d'
}

/**
 * 侧栏分组渲染顺序:`in_progress` 优先(常用状态放最显眼的位置)。
 * `REGULAR_STATUS_ORDER`(去掉 abandoned)用于常规 4 组渲染,
 * `BUCKET_STATUS_ORDER`(完整 5 个)用于「已收起」bucket 内的子分组。
 */
export const SIDEBAR_STATUS_ORDER: GoalStatus[] = [
  'in_progress',
  'not_started',
  'done',
  'shelved',
  'abandoned'
]

/** 关系图节点视觉优先级:`done` 优先,引导用户关注已完成 / 当前进度。 */
export const GRAPH_STATUS_ORDER: GoalStatus[] = [
  'done',
  'in_progress',
  'not_started',
  'shelved',
  'abandoned'
]

/** 表单下拉选项:`{ value, label }[]`,顺序与 SIDEBAR 一致。 */
export const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'not_started', label: STATUS_LABELS.not_started },
  { value: 'done', label: STATUS_LABELS.done },
  { value: 'shelved', label: STATUS_LABELS.shelved },
  { value: 'abandoned', label: STATUS_LABELS.abandoned }
]
