import type { Goal, GoalInput, Config, Edge } from './types'

export interface BrokenEntry {
  id: string
  error: string
}

export interface GoalAPI {
  list(): Promise<{ goals: Goal[]; broken: BrokenEntry[] }>
  get(id: string): Promise<Goal | null>
  create(input: GoalInput): Promise<Goal>
  update(id: string, patch: Partial<GoalInput>): Promise<Goal>
  /**
   * 快速调整进度：`delta` 为 +1/+5 时递增 current；为 -1/-5 时递减（不低于 0）；
   * 当前没有 progress 时初始化为 { current: max(delta,1), total: null }。
   */
  progressBump(id: string, delta: number): Promise<Goal>
  /** 删除目标 —— 实际是移到 `<data_dir>/.trash/`，可还原。 */
  delete(id: string): Promise<void>
}

export interface RelationsAPI {
  get(): Promise<Edge[]>
  set(edges: Edge[]): Promise<void>
}

export interface ConfigAPI {
  get(): Promise<Config>
  set(patch: Partial<Config>): Promise<Config>
}

export interface DataAPI {
  pickDir(): Promise<string | null>
  revealInExplorer(): Promise<void>
}

/** 回收站条目（按 deleted_at 倒序返回） */
export interface TrashEntry {
  goal_id: string
  /** unix ms；同名 goal 多次删除会有不同 timestamp */
  deleted_at: number
  /** ISO 8601 字符串，与 .md 里 created/updated 同款 */
  deleted_at_iso: string
  title: string
  category: string
}

export interface TrashAPI {
  list(): Promise<TrashEntry[]>
  /**
   * 从回收站还原一个目标。涉及 relations 的合并，会跑 cycle 检测；
   * 引入环时返回 Err，goals/<id>.md 也会回滚。
   */
  restore(id: string, deletedAt: number): Promise<Goal>
  /** 永久删除一个回收站条目。 */
  purge(id: string, deletedAt: number): Promise<void>
  /** 清空整个回收站，返回删除的文件总数。 */
  empty(): Promise<number>
}

export interface TrackerAPI {
  goals: GoalAPI
  relations: RelationsAPI
  config: ConfigAPI
  data: DataAPI
  trash: TrashAPI
}
