// 人生目标追踪器 —— Goal 领域类型定义
//
// 通用类型（Edge / Progress / RelationsFile / UnlockResult / UnlockRule）已抽到
// monorepo 共享内核 `@core`（packages/tracker-core），本文件 re-export 保持
// 现有 `@shared/types` 引用不变；Goal 领域类型留在这里。

export type {
  Edge,
  Progress,
  RelationsFile,
  UnlockResult,
  UnlockRule,
  BrokenEntry,
  PrereqSpec,
  ExcludeSpec
} from '@core'

import type { Progress } from '@core'

/** 目标推进状态 */
export type GoalStatus =
  | 'not_started' // 未开始
  | 'in_progress' // 进行中
  | 'done' // 已达成
  | 'shelved' // 搁置
  | 'abandoned' // 放弃

/** 创建/编辑输入：用户填的字段（不含 id/created/updated） */
export type GoalInput = Omit<Goal, 'id' | 'created' | 'updated'>

/** 一个目标 */
export interface Goal {
  id: string
  title: string
  /** 描述 / 备注 */
  note: string
  /** 分类，如"学业 / 科研 / 健康" */
  category: string
  /** 截止日期 YYYY-MM-DD；null = 无截止 */
  deadline: string | null
  status: GoalStatus
  /** 量化进度（如"2 篇 SCI 已完成 1 篇"）；null = 无量化目标 */
  progress: Progress | null
  /**
   * 可计数任务：别的目标引用时可指定需要完成多少次。
   * - 当其他目标 simple spec 引用本目标时，可携带 `count`（默认 1）；
   *   解锁判定改为 progress.current >= count（而不是看 status==='done'）。
   * - 自身"已达成"仍按 status==='done' 手动标记；
   *   countable 任务在概念上不存在"全达成"——总是能再做下一篇，
   *   完成的是它的"第 N 篇"这种具体引用方。
   * - 写盘：仅 true 时写入 frontmatter，与 pinned/hidden 同款。
   */
  countable: boolean
  /** 置顶展示：状态为进行中时，显示在 CleanMode 顶部的『进行中』栏 */
  pinned: boolean
  /** 日常模式收起：状态为未开始/进行中时，从『现在能推进的目标』列表隐藏（纯展示，不影响解锁） */
  hidden: boolean
  /** ISO 8601 字符串 */
  created: string
  /** ISO 8601 字符串 */
  updated: string
}

/**
 * 达成判定：status === 'done'，或量化进度已满（current >= total）。
 * 只有"达成"的目标才能解锁其前置目标（book-tracker 的 finished 对应物）。
 */
export function isGoalDone(g: Goal): boolean {
  if (g.status === 'done') return true
  return !!g.progress && g.progress.total !== null && g.progress.current >= g.progress.total
}

/** 配置文件（数据目录自带） */
export interface Config {
  version: number
  /** 用户数据根目录 */
  data_dir: string
  language: 'zh-CN'
  default_mode: 'clean' | 'edit'
}
