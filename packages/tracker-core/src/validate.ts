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

/** 违规代码：同一个 `to` 存在多条前置边。 */
export const CODE_DUPLICATE_TO = 'duplicate_to'

/** 一条不变量违规。 */
export interface EdgeIssue {
  /** 机器可读代码，见 `CODE_*` 常量（便于调用方分流，不依赖文案）。 */
  code: typeof CODE_DUPLICATE_TO
  /** 涉及的 `edge.to`。 */
  to: string
  /** 人读说明（中文，可直接展示给用户）。 */
  message: string
}

/**
 * 校验 edges 的不变量，返回全部违规（空数组 = 无问题）。
 *
 * 当前唯一检查：**`to` 唯一性**。
 *
 * 返回顺序按各 `to` 在 `edges` 中**首次出现的顺序**（`Map` 保序），因此输出稳定、
 * 可直接用于测试断言与两端结果比对。
 */
export function validateEdges(edges: Edge[]): EdgeIssue[] {
  // Map 保持插入顺序 —— 首次出现顺序即输出顺序
  const counts = new Map<string, number>()
  for (const e of edges) {
    counts.set(e.to, (counts.get(e.to) ?? 0) + 1)
  }

  const issues: EdgeIssue[] = []
  for (const [to, n] of counts) {
    if (n > 1) {
      issues.push({
        code: CODE_DUPLICATE_TO,
        to,
        message: `目标 ${to} 有 ${n} 条前置边；解锁计算只会采用最后一条，另外 ${n - 1} 条的前置条件会被静默丢弃`
      })
    }
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
