import { describe, expect, it } from 'vitest'
import { computeBlockingRelations, computeUnlocked, detectCycles } from '../unlock'
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

describe('computeBlockingRelations', () => {
  it('空图返回空 Map', () => {
    expect(computeBlockingRelations([]).size).toBe(0)
  })

  it('单边 a→b：a.blocks=[b], b.blockedBy=[a]', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = computeBlockingRelations(edges)
    expect(r.get('a')?.blocks).toEqual(['b'])
    expect(r.get('a')?.blockedBy).toEqual([])
    expect(r.get('b')?.blocks).toEqual([])
    expect(r.get('b')?.blockedBy).toEqual(['a'])
  })

  it('孤立节点也出现在 Map 里（blocks/blockedBy 都为空）', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = computeBlockingRelations(edges)
    expect(r.has('a')).toBe(true)
    expect(r.has('b')).toBe(true)
  })

  it('链 a→b→c：a 直接 blocks b，b 直接 blocks c；不做传递', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' }
    ]
    const r = computeBlockingRelations(edges)
    expect(r.get('a')?.blocks).toEqual(['b'])
    expect(r.get('b')?.blocks).toEqual(['c'])
    expect(r.get('c')?.blocks).toEqual([])
    // 关键：不传递 —— a 不直接 blocks c
    expect(r.get('a')?.blocks.includes('c')).toBe(false)
  })

  it('多对一汇合：b/c 都依赖 a → a.blocks=[b,c]', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['a'], rule: 'all' }
    ]
    const r = computeBlockingRelations(edges)
    expect(r.get('a')?.blocks.sort()).toEqual(['b', 'c'])
  })

  it('一对多拆分：c 依赖 [a,b] → c.blockedBy=[a,b]', () => {
    const edges: Edge[] = [
      { to: 'c', prerequisites: ['a', 'b'], rule: 'all' }
    ]
    const r = computeBlockingRelations(edges)
    expect(r.get('c')?.blockedBy.sort()).toEqual(['a', 'b'])
    expect(r.get('a')?.blocks).toEqual(['c'])
    expect(r.get('b')?.blocks).toEqual(['c'])
  })

  it('重复引用去重', () => {
    const edges: Edge[] = [
      { to: 'c', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['a'], rule: 'all' } // duplicate_to 情况
    ]
    const r = computeBlockingRelations(edges)
    expect(r.get('a')?.blocks).toEqual(['c'])
    expect(r.get('c')?.blockedBy).toEqual(['a'])
  })

  it('exclude spec 不建立 blocks/blockedBy 边（它是谓词改写规则）', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a'],
        rule: 'all',
        excludes: [{ kind: 'exclude', trigger: 'x', target: 'a', effect: 'disqualifies' }]
      }
    ]
    const r = computeBlockingRelations(edges)
    // a 是 t 的前置（来自 prerequisites），进入 blockedBy
    expect(r.get('a')?.blockedBy).toEqual([])
    expect(r.get('a')?.blocks).toEqual(['t'])
    expect(r.get('t')?.blockedBy).toEqual(['a'])
    // x 通过 exclude 关联到 t，但 exclude 不构成正向引用 → x 不在 map 里
    expect(r.has('x')).toBe(false)
    expect(r.has('a')).toBe(true)
  })

  it('specs 里 simple / group / count 都参与正向引用', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: [],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'a' },
          { kind: 'group', members: ['b', 'c'], pick: 1 },
          { kind: 'count', members: ['d', 'e'], need: 2 }
        ]
      }
    ]
    const r = computeBlockingRelations(edges)
    expect(r.get('t')?.blockedBy.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(r.get(id)?.blocks).toEqual(['t'])
    }
  })

  it('prerequisites 与 specs 同时给定时合并去重', () => {
    // 同一 id 既在 prerequisites 也在 specs.simple —— 合并去重
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a', 'b'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'a' },
          { kind: 'simple', id: 'c' }
        ]
      }
    ]
    const r = computeBlockingRelations(edges)
    expect(r.get('t')?.blockedBy.sort()).toEqual(['a', 'b', 'c'])
  })
})