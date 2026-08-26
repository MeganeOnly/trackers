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

/** 前置规格（v2）：每条 Edge 的解锁条件可由多种规格组合（AND-of-specs） */
export type PrereqKind = 'simple' | 'group' | 'count' | 'exclude'

/** 简单前置：单个目标引用 */
export interface SimpleSpec {
  kind: 'simple'
  id: string
  /**
   * 引用次数（仅当被引用目标是 `countable` 任务时才有意义）：
   * - 缺省 / 1：等价于"目标已完成即可"（普通任务与 countable 任务都适用）
   * - >= 2：要求 countable 任务的 progress.current >= count 才算 done
   *
   * 注：调用方写盘时，count === 1 应省略（避免污染 relations.json）。
   */
  count?: number
}

/** 二选一 / N 选一组合：成员里至少 `pick` 个 done 即满足该 spec */
export interface GroupSpec {
  kind: 'group'
  members: string[]
  /** 默认 1（任选其一）；设为 K 即 N 选 K */
  pick?: number
}

/** 计数任务：成员里至少 `need` 个 done */
export interface CountSpec {
  kind: 'count'
  members: string[]
  need: number
}

/**
 * 互斥 / 失效规则：用于『所长奖学金获得者原则上不再参选当年度冠名奖学金』类逻辑。
 * 不参与正向 AND-of-specs 计数，而是改写 `isDone` 谓词。
 */
export interface ExcludeSpec {
  kind: 'exclude'
  /** 触发目标：达成时触发 effect */
  trigger: string
  /** 被影响目标 */
  target: string
  /**
   * - `disqualifies`（默认）：trigger 已 done → target 视为「失格」，
   *   任何前置边看 target 时不算 done（典型：拿到所长奖 → 不能再算冠名奖学金前置）。
   * - `satisfies`：trigger 已 done → target 在解锁谓词里视为已 done（典型：A 完成 → B 的前置豁免）。
   */
  effect: 'disqualifies' | 'satisfies'
}

export type PrereqSpec = SimpleSpec | GroupSpec | CountSpec | ExcludeSpec

/** 一条前置边：目标条目 `to` 需要 `prerequisites` 中若干已完成 */
export interface Edge {
  to: string
  prerequisites: string[]
  rule: UnlockRule
  /** 仅 rule === 'any_of' 时使用 */
  threshold?: number
  /**
   * 二选一/N选一组合（AND-of-ORs，旧版）：
   * 每个内层数组是一组「互斥选一」的成员 id（任一个 done 即满足该组）；
   * 组与组之间、以及「不在任何组里的前置」均为「全部必须 done」。
   * 缺省 / 空数组时回退到 `rule` + `threshold` 的整组逻辑（向后兼容）。
   */
  groups?: string[][]
  /**
   * v2：完整规格清单。
   * - 当 `specs` 非空且至少含一个非 `exclude` 的正向 spec 时，使用新算法：
   *   AND-of-specs（全部 spec 满足才解锁），`exclude` 不算『正向 spec』，只改写 done 谓词。
   * - 当 `specs` 为空 / 缺省 / 全部为 `exclude` 时，回退到 `rule+threshold+groups` 的旧路径。
   */
  specs?: PrereqSpec[]
  /**
   * v2：独立的互斥规则索引位置（避免 specs 与 exclude 混排）。与 `specs` 中的
   * `exclude` 项行为完全一致，只是位置独立便于渲染。
   */
  excludes?: ExcludeSpec[]
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
