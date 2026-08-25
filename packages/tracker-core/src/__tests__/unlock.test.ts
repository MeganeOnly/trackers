import { describe, expect, it } from 'vitest'
import { computeUnlocked, detectCycles } from '../unlock'
import type { Edge } from '../types'

describe('computeUnlocked', () => {
  it('无前置的条目永远解锁', () => {
    const r = computeUnlocked(['a'], [], () => false)
    expect(r.unlocked.get('a')).toBe(true)
  })

  it('rule=all: 所有前置 done 才解锁', () => {
    const edges: Edge[] = [{ to: 'c', prerequisites: ['a', 'b'], rule: 'all' }]
    const done = (id: string) => id === 'a'
    const r = computeUnlocked(['a', 'b', 'c'], edges, done)
    expect(r.unlocked.get('a')).toBe(true)
    expect(r.unlocked.get('b')).toBe(true)
    expect(r.unlocked.get('c')).toBe(false)

    const r2 = computeUnlocked(['a', 'b', 'c'], edges, (id) => id === 'a' || id === 'b')
    expect(r2.unlocked.get('c')).toBe(true)
  })

  it('rule=any_of: 至少 threshold 个 done', () => {
    const edges: Edge[] = [
      { to: 'target', prerequisites: ['a', 'b', 'c'], rule: 'any_of', threshold: 2 }
    ]
    const r = computeUnlocked(['a', 'b', 'c', 'target'], edges, (id) => id === 'a' || id === 'b')
    expect(r.unlocked.get('target')).toBe(true)

    const r2 = computeUnlocked(['a', 'b', 'c', 'target'], edges, (id) => id === 'a')
    expect(r2.unlocked.get('target')).toBe(false)
  })

  it('done 谓词之外的条目一律不算完成', () => {
    const edges: Edge[] = [{ to: 'target', prerequisites: ['a', 'b', 'c'], rule: 'all' }]
    const r = computeUnlocked(['a', 'b', 'c', 'target'], edges, () => false)
    expect(r.unlocked.get('target')).toBe(false)
  })

  it('循环依赖：环上的条目标 false 并报告环', () => {
    const edges: Edge[] = [
      { to: 'a', prerequisites: ['b'], rule: 'all' },
      { to: 'b', prerequisites: ['a'], rule: 'all' }
    ]
    const r = computeUnlocked(['a', 'b'], edges, () => false)
    expect(r.unlocked.get('a')).toBe(false)
    expect(r.unlocked.get('b')).toBe(false)
    expect(r.cycles.length).toBeGreaterThan(0)
  })

  it('悬空引用被静默忽略', () => {
    const edges: Edge[] = [
      { to: 'target', prerequisites: ['a', 'ghost'], rule: 'all' }
    ]
    const r = computeUnlocked(['a', 'target'], edges, (id) => id === 'a')
    expect(r.unlocked.get('target')).toBe(true)
  })
})

describe('detectCycles', () => {
  it('无环返回空', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    expect(detectCycles(edges)).toEqual([])
  })

  it('自环 (a→a) 被检测', () => {
    const edges: Edge[] = [{ to: 'a', prerequisites: ['a'], rule: 'all' }]
    const cycles = detectCycles(edges)
    expect(cycles.length).toBeGreaterThan(0)
  })
})