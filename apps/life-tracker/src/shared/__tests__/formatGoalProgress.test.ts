import { describe, expect, it } from 'vitest'
import { formatGoalProgress } from '../progress'

/**
 * Regression:同 book-tracker 的 `formatProgress` —— IPC payload 里
 * `progress.total` 会被 Rust 端 `#[serde(skip_serializing_if = "Option::is_none")]`
 * 省略成 undefined,`!== null` 判断会漏判,undefined 被拼进字符串显示成
 * "10/undefined"。`@core/types.ts` 把 `total` 改成 `total?: number | null`,
 * `formatGoalProgress` 改用 `!= null` 修复。
 */
describe('formatGoalProgress (IPC undefined 兼容)', () => {
  it('total=undefined(模拟 IPC 缺字段) → 不输出 "10/undefined"', () => {
    const p = { current: 10 } as unknown as Parameters<typeof formatGoalProgress>[0]
    expect(formatGoalProgress(p)).not.toContain('undefined')
    expect(formatGoalProgress(p)).toBe('10 项')
  })

  it('total=null → "10 项"', () => {
    expect(formatGoalProgress({ current: 10, total: null })).toBe('10 项')
  })

  it('total=数字 → "10 / 24"', () => {
    expect(formatGoalProgress({ current: 10, total: 24 })).toBe('10 / 24')
  })

  it('current=0 且 total=null → ""', () => {
    expect(formatGoalProgress({ current: 0, total: null })).toBe('')
  })

  it('null / undefined → ""', () => {
    expect(formatGoalProgress(null)).toBe('')
    expect(formatGoalProgress(undefined)).toBe('')
  })
})