import { describe, expect, it } from 'vitest'
import {
  bumpProgress,
  normalizeProgressInput,
  parseProgress,
  progressPercent
} from '../progress'

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