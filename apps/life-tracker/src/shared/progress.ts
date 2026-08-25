import type { Progress } from './types'

/**
 * 把 progress 渲染成可读字符串（领域文案："N / M" 或 "N 项"）。
 * parse / normalize / bump / percent 等纯函数在共享内核 `@core`（packages/tracker-core）。
 */
export function formatGoalProgress(p: Progress | null | undefined): string {
  if (!p) return ''
  if (p.total !== null) return `${p.current} / ${p.total}`
  if (p.current > 0) return `${p.current} 项`
  return ''
}
