// tracker-core —— relations 不变量校验
//
// 与 `crates/tracker-core/src/validate.rs` 1:1 对应（同样的检查、同样的稳定输出顺序）。
//
// # 为什么需要
//
// `computeUnlocked` 用 `edgeByTo.set(e.to, ...)`（Rust 端 `edge_by_to.insert`）把边索引成
// `to → Edge`。同一个 `to` 出现多条边时**后者静默覆盖前者**，前者的全部前置条件消失
// —— 不报错、不警告、不留痕。
//
// 该不变量目前只由 UI 保证（`PrereqEditor` 保存时 `filter(e.to !== id)` + push 的 upsert
// 语义），内核本身不校验。可能破坏它的入口：用户手工编辑 `relations.json`、未来的批量
// 导入 / 迁移脚本、任何新增写入路径。
//
// 同类「静默丢前置」事故已发生过一次：Rust 端 `normalize_edge` 曾用
// `..Default::default()` 把 `specs` / `excludes` 清成 None，症状是「加了前置或互斥规则
// 但读不到，像被删除了一样」。
//
// # 定位
//
// 本模块只**报告**问题，不修改数据、不阻止任何操作 —— 调用方决定如何呈现。

import type { Edge } from './types'
import { detectCycles } from './unlock'

/** 违规代码：同一个 `to` 存在多条前置边。 */
export const CODE_DUPLICATE_TO = 'duplicate_to'

/** 违规代码：关系图中存在循环依赖（环上节点全部锁死）。 */
export const CODE_CYCLE = 'cycle'

/** 所有违规代码的联合类型（便于调用方 switch / 分流）。 */
export type EdgeIssueCode = typeof CODE_DUPLICATE_TO | typeof CODE_CYCLE

/** 一条不变量违规。 */
export interface EdgeIssue {
  /** 机器可读代码，见 `CODE_*` 常量（便于调用方分流，不依赖文案）。 */
  code: EdgeIssueCode
  /** 涉及的 `edge.to`（环检测场景下取环的第一个节点）。 */
  to: string
  /** 人读说明（中文，可直接展示给用户）。 */
  message: string
  /**
   * 仅 `code === CODE_CYCLE` 时存在：环的完整路径（首尾相同，例如 `["a","b","c","a"]`）。
   * 非环问题此字段缺省。
   */
  cycle?: string[]
}

/**
 * 校验 edges 的不变量，返回全部违规（空数组 = 无问题）。
 *
 * 当前检查：
 * - **`to` 唯一性**：重复 `to` 会让 `computeUnlocked` 静默覆盖（详见模块顶部注释）。
 * - **环检测**：`computeUnlocked` 已自带环检测并把环上节点置 false；本函数也独立报一份，
 *   让"关系图是否健康"这个事实有单一通道输出，便于 UI / 日志 / 后端 write 时统一处理。
 *
 * 输出顺序：
 * - `duplicate_to` 在前（按首次出现顺序）
 * - `cycle` 在后（按 detectCycles 报告顺序）
 *
 * 输出稳定（无 `Set` 迭代顺序依赖），可直接用于测试断言与两端结果比对。
 */
export function validateEdges(edges: Edge[]): EdgeIssue[] {
  const issues: EdgeIssue[] = []

  // 1) duplicate_to：Map 保持插入顺序，首次出现顺序即输出顺序
  const counts = new Map<string, number>()
  for (const e of edges) {
    counts.set(e.to, (counts.get(e.to) ?? 0) + 1)
  }
  for (const [to, n] of counts) {
    if (n > 1) {
      issues.push({
        code: CODE_DUPLICATE_TO,
        to,
        message: `目标 ${to} 有 ${n} 条前置边；解锁计算只会采用最后一条，另外 ${n - 1} 条的前置条件会被静默丢弃`
      })
    }
  }

  // 2) cycle：复用 unlock.ts 的 detectCycles（同一份实现，避免重复 DFS）
  for (const cycle of detectCycles(edges)) {
    // cycle 形如 ["a","b","c","a"]，取首节点作 to（与现有 schema 兼容）
    const head = cycle[0] ?? ''
    issues.push({
      code: CODE_CYCLE,
      to: head,
      message: `存在循环依赖: ${cycle.join(' → ')}`,
      cycle
    })
  }

  return issues
}

/**
 * 把违规列表格式化成单行摘要（用于日志 / 警告条）。无违规返回 null。
 *
 * 最多列出前 3 条明细，其余折叠成计数，避免日志被超长行淹没。
 */
export function formatIssues(issues: EdgeIssue[]): string | null {
  if (issues.length === 0) return null
  const shown = issues.slice(0, 3).map((i) => i.message)
  let s = `relations 存在 ${issues.length} 处不变量问题: ${shown.join('; ')}`
  if (issues.length > shown.length) {
    s += `（另有 ${issues.length - shown.length} 处未列出）`
  }
  return s
}
