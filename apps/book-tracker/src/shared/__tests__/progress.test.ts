import { describe, expect, it } from 'vitest'
import {
  bumpProgress,
  formatProgress,
  normalizeProgressInput,
  parseProgress,
  progressPercent
} from '../progress'
import matter from 'gray-matter'

describe('parseProgress', () => {
  it('null / undefined → null', () => {
    expect(parseProgress(null)).toBeNull()
    expect(parseProgress(undefined)).toBeNull()
  })

  it('非对象 → null', () => {
    expect(parseProgress(42)).toBeNull()
    expect(parseProgress('hello')).toBeNull()
  })

  it('只有 current → total=null', () => {
    expect(parseProgress({ current: 12 })).toEqual({ current: 12, total: null })
  })

  it('current + total → 完整', () => {
    expect(parseProgress({ current: 12, total: 100 })).toEqual({
      current: 12,
      total: 100
    })
  })

  it('current 为负或非数 → null', () => {
    expect(parseProgress({ current: -1, total: 100 })).toBeNull()
    expect(parseProgress({ current: 'abc', total: 100 })).toBeNull()
    expect(parseProgress({ current: NaN, total: 100 })).toBeNull()
    expect(parseProgress({ current: Infinity, total: 100 })).toBeNull()
  })

  it('total=0 / total 负 → total=null', () => {
    expect(parseProgress({ current: 12, total: 0 })).toEqual({
      current: 12,
      total: null
    })
    expect(parseProgress({ current: 12, total: -5 })).toEqual({
      current: 12,
      total: null
    })
  })

  it('current 浮点 → 向下取整', () => {
    expect(parseProgress({ current: 12.7, total: 100 })).toEqual({
      current: 12,
      total: 100
    })
  })
})

describe('normalizeProgressInput', () => {
  it('同 parseProgress 的语义', () => {
    expect(normalizeProgressInput(null)).toBeNull()
    expect(normalizeProgressInput({ current: 12, total: 100 })).toEqual({
      current: 12,
      total: 100
    })
    expect(normalizeProgressInput({ current: 5, total: null })).toEqual({
      current: 5,
      total: null
    })
    expect(normalizeProgressInput({ current: 12, total: 0 })).toEqual({
      current: 12,
      total: null
    })
  })
})

describe('formatProgress', () => {
  it('total 已知 → "current / total"', () => {
    expect(formatProgress({ current: 12, total: 100 })).toBe('12 / 100')
  })
  it('total=null 且 current>0 → "current 章 · 连载中"', () => {
    expect(formatProgress({ current: 12, total: null })).toBe('12 章 · 连载中')
  })
  it('total=null 且 current=0 → ""', () => {
    expect(formatProgress({ current: 0, total: null })).toBe('')
  })
  it('total=null 输入格式（current + total:null）→ 兼容', () => {
    // normalizeProgressInput 的归一化路径：显式 total=null 正确处理
    expect(formatProgress(normalizeProgressInput({ current: 5, total: null }))).toBe(
      '5 章 · 连载中'
    )
  })
  it('null / undefined → ""', () => {
    expect(formatProgress(null)).toBe('')
    expect(formatProgress(undefined)).toBe('')
  })
})

describe('progressPercent', () => {
  it('total 已知 → 0~100', () => {
    expect(progressPercent({ current: 25, total: 100 })).toBe(25)
    expect(progressPercent({ current: 50, total: 200 })).toBe(25)
  })
  it('超过 total → 100', () => {
    expect(progressPercent({ current: 150, total: 100 })).toBe(100)
  })
  it('total=null → 0', () => {
    expect(progressPercent({ current: 50, total: null })).toBe(0)
  })
  it('null / undefined → 0', () => {
    expect(progressPercent(null)).toBe(0)
    expect(progressPercent(undefined)).toBe(0)
  })
})

describe('bumpProgress', () => {
  it('正 delta：递增 current', () => {
    expect(bumpProgress({ current: 10, total: 100 }, 1)).toEqual({
      current: 11,
      total: 100
    })
    expect(bumpProgress({ current: 10, total: 100 }, 5)).toEqual({
      current: 15,
      total: 100
    })
  })

  it('负 delta：递减 current，下限 0', () => {
    expect(bumpProgress({ current: 10, total: 100 }, -1)).toEqual({
      current: 9,
      total: 100
    })
    expect(bumpProgress({ current: 2, total: 100 }, -5)).toEqual({
      current: 0,
      total: 100
    })
  })

  it('无 progress：初始化 total=null，current=max(delta,1)', () => {
    expect(bumpProgress(null, 1)).toEqual({ current: 1, total: null })
    expect(bumpProgress(null, 5)).toEqual({ current: 5, total: null })
    expect(bumpProgress(null, -1)).toEqual({ current: 1, total: null })
  })

  it('保留 total', () => {
    expect(bumpProgress({ current: 10, total: null }, 1)).toEqual({
      current: 11,
      total: null
    })
  })
})

/**
 * gray-matter 往返测试：parseProgress 必须能解析 gray-matter.stringify 写出的格式。
 * 这保护 frontmatter 序列化不会因为 YAML 引号/嵌套格式变化而 break 解析。
 */
describe('gray-matter round-trip', () => {
  it('嵌套对象格式 → parseProgress', () => {
    const fm = {
      id: 'x',
      title: 'x',
      author: 'a',
      progress: { current: 12, total: 100 }
    }
    const out = matter.stringify('# x', fm)
    const parsed = matter(out)
    expect(parsed.data.progress).toEqual({ current: 12, total: 100 })
    expect(parseProgress(parsed.data.progress)).toEqual({ current: 12, total: 100 })
  })

  it('只写 progress，不污染 frontmatter', () => {
    const fm: Record<string, unknown> = { id: 'x', title: 'x' }
    fm.progress = { current: 5, total: 10 }
    const out = matter.stringify('# x', fm)
    expect(out).toContain('progress:')
    expect(out).toContain('current: 5')
    expect(out).toContain('total: 10')
  })
})