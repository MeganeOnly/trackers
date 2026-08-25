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

  it('groups 二选一组合：必选项全部 done 且每组至少一个 done', () => {
    const edges: Edge[] = [
      { to: 'target', prerequisites: ['a', 'b', 'c'], rule: 'all', groups: [['a', 'b']] }
    ]
    // c 必须；a/b 二选一
    const r1 = computeUnlocked(['a', 'b', 'c', 'target'], edges, (id) => id === 'a' || id === 'c')
    expect(r1.unlocked.get('target')).toBe(true)
    const r2 = computeUnlocked(['a', 'b', 'c', 'target'], edges, (id) => id === 'b' || id === 'c')
    expect(r2.unlocked.get('target')).toBe(true)
    // 只有 a（缺 c）→ 不解锁
    const r3 = computeUnlocked(['a', 'b', 'c', 'target'], edges, (id) => id === 'a')
    expect(r3.unlocked.get('target')).toBe(false)
    // 只有 c（组内一个都没完成）→ 不解锁
    const r4 = computeUnlocked(['a', 'b', 'c', 'target'], edges, (id) => id === 'c')
    expect(r4.unlocked.get('target')).toBe(false)
  })

  it('groups 多组：所有组都要至少一个 done', () => {
    const edges: Edge[] = [
      {
        to: 'target',
        prerequisites: ['a', 'b', 'c', 'd'],
        rule: 'all',
        groups: [
          ['a', 'b'],
          ['c', 'd']
        ]
      }
    ]
    const r1 = computeUnlocked(['a', 'b', 'c', 'd', 'target'], edges, (id) => id === 'a' || id === 'c')
    expect(r1.unlocked.get('target')).toBe(true)
    // 只完成第一组 → 第二组没满足 → 不解锁
    const r2 = computeUnlocked(['a', 'b', 'c', 'd', 'target'], edges, (id) => id === 'a')
    expect(r2.unlocked.get('target')).toBe(false)
  })

  it('groups 空数组回退到 rule=all 语义', () => {
    const edges: Edge[] = [
      { to: 'target', prerequisites: ['a', 'b'], rule: 'all', groups: [] }
    ]
    const r1 = computeUnlocked(['a', 'b', 'target'], edges, (id) => id === 'a')
    expect(r1.unlocked.get('target')).toBe(false)
    const r2 = computeUnlocked(['a', 'b', 'target'], edges, (id) => id === 'a' || id === 'b')
    expect(r2.unlocked.get('target')).toBe(true)
  })

  it('groups 引用悬空成员：组内有真实成员完成即可解锁；全悬空组不解锁', () => {
    // 组内 a 完成即满足该组，ghost 悬空不阻塞
    const edges1: Edge[] = [
      { to: 'target', prerequisites: ['a', 'ghost'], rule: 'all', groups: [['a', 'ghost']] }
    ]
    const r1 = computeUnlocked(['a', 'target'], edges1, (id) => id === 'a')
    expect(r1.unlocked.get('target')).toBe(true)

    // 组全悬空 → 该组永远不满足 → 不解锁
    const edges2: Edge[] = [
      { to: 'target', prerequisites: ['a'], rule: 'all', groups: [['ghost1', 'ghost2']] }
    ]
    const r2 = computeUnlocked(['a', 'target'], edges2, () => false)
    expect(r2.unlocked.get('target')).toBe(false)
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