// tracker-core —— 共享类型（领域无关）
//
// 两个 tracker app 共用的通用类型。领域类型（Book / Goal / Config 等）由各 app 定义。
// 与 `crates/tracker-core/src/types.rs` 1:1 对应（IPC JSON 字段一致）。

/** 进度。total = null 表示总量未知（连载 / 开放式目标）。 */
export interface Progress {
  /** 当前进度（≥0） */
  current: number
  /** 总量；null = 未知 */
  total: number | null
}

/** 解锁规则 */
export type UnlockRule = 'all' | 'any_of'

/** 一条前置边：目标条目 `to` 需要 `prerequisites` 中若干已完成 */
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

/** 加载时损坏的条目 */
export interface BrokenEntry {
  id: string
  error: string
}

/** 解锁结果 */
export interface UnlockResult {
  /** id -> 是否解锁 */
  unlocked: Map<string, boolean>
  /** 循环依赖的条目 id 列表（这些不参与解锁计算） */
  cycles: string[][]
}
