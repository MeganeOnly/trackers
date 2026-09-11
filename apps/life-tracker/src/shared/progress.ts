import type { Progress } from './types'

/**
 * 把 progress 渲染成可读字符串（领域文案："N / M" 或 "N 项"）。
 * parse / normalize / bump / percent 等纯函数在共享内核 `@core`（packages/tracker-core）。
 *
 * **必须用 `!= null` 而非 `!== null`**：`Progress.total` 在 IPC payload 里会被
 * Rust 端 `#[serde(skip_serializing_if = "Option::is_none")]` 省略成 undefined,
 * 见 `@core/types.ts` Progress 注释。`undefined !== null` 是 `true`,会让
 * undefined 拼进字符串显示成 "10/undefined"。
 */
export function formatGoalProgress(p: Progress | null | undefined): string {
  if (!p) return ''
  if (p.total != null) return `${p.current} / ${p.total}`
  if (p.current > 0) return `${p.current} 项`
  return ''
}
