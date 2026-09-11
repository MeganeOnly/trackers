import { describe, expect, it } from 'vitest'
import { formatProgress } from '../progress'

/**
 * Regression:IPC payload 里的 `progress.total` 会被 Rust 端
 * `#[serde(skip_serializing_if = "Option::is_none")]` 省略成 undefined。
 * 用 `!== null` 判断会漏判(undefined !== null 是 true),把 undefined 拼进字符串
 * 显示成 "10/undefined" —— 见 `apps/book-tracker/AGENTS.md` 经验沉淀 §十.
 *
 * 修复:`@core/types.ts` 把 `total` 改成 `total?: number | null`(语义对齐 IPC);
 * `formatProgress` 改用 `!= null`(loose equality 同时排除 null/undefined)。
 */
describe('formatProgress (IPC undefined 兼容)', () => {
  it('total=undefined(模拟 IPC 缺字段) → 不输出 "10/undefined"', () => {
    // 模拟 IPC payload:{"current":10}(Rust 端 skip_serializing 省略了 total key)
    const p = { current: 10 } as unknown as Parameters<typeof formatProgress>[0]
    expect(formatProgress(p)).not.toContain('undefined')
    expect(formatProgress(p)).toBe('10 · 连载中')
  })

  it('total=null → "10 · 连载中"', () => {
    expect(formatProgress({ current: 10, total: null })).toBe('10 · 连载中')
  })

  it('total=数字 → "10 / 24"', () => {
    expect(formatProgress({ current: 10, total: 24 })).toBe('10 / 24')
  })

  it('current=0 且 total=null → ""', () => {
    expect(formatProgress({ current: 0, total: null })).toBe('')
  })

  it('null / undefined → ""', () => {
    expect(formatProgress(null)).toBe('')
    expect(formatProgress(undefined)).toBe('')
  })
})