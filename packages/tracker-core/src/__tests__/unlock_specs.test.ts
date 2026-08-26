import { describe, expect, it } from 'vitest'
import { computeUnlocked, detectCycles, collectExcludes } from '../unlock'
import type { Edge, ExcludeSpec } from '../types'

/**
 * v2 前置规格（specs + excludes）的语义约束。
 * 应用层负责把 excludes 转写到 isDone 谓词；本测试通过两种路径覆盖：
 *   路径 A：在传入 isDone 前手工改写 done set（模拟应用层）
 *   路径 B：直接构造 specs+excludes 验证 collectExcludes 去重
 */

function done(ids: string[]): (id: string, k: number) => boolean {
  const s = new Set(ids)
  return (id: string, _k: number) => s.has(id)
}

describe('computeUnlocked — v2 specs', () => {
  it('simple spec: 引用即满足', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a'],
        rule: 'all',
        specs: [{ kind: 'simple', id: 'a' }]
      }
    ]
    const r1 = computeUnlocked(['a', 't'], edges, done(['a']))
    expect(r1.unlocked.get('t')).toBe(true)
    const r2 = computeUnlocked(['a', 't'], edges, done([]))
    expect(r2.unlocked.get('t')).toBe(false)
  })

  it('simple spec with count: 引用方把 requiredCount 透传给应用层谓词', () => {
    // 模拟应用层：用一个 Map<id, current> 表示可计数任务的进度，
    // 普通任务不存在时视作 done。
    const progress: Record<string, number> = { sci: 1 }
    const isDone = (id: string, k: number): boolean => {
      if (id in progress) return progress[id] >= k
      // 普通任务：自身 status==='done' 视情况而定；这里简化为只要在集合中就算 done
      return true
    }
    const edges: Edge[] = [
      {
        to: 'award',
        prerequisites: ['sci'],
        rule: 'all',
        specs: [{ kind: 'simple', id: 'sci', count: 2 }]
      }
    ]
    // progress.current = 1 < 2 → 锁
    expect(computeUnlocked(['sci', 'award'], edges, isDone).unlocked.get('award')).toBe(false)
    // 进度涨到 2 → 解锁
    progress.sci = 2
    expect(computeUnlocked(['sci', 'award'], edges, isDone).unlocked.get('award')).toBe(true)
    // 进度 3 → 仍解锁（>= 即通过）
    progress.sci = 3
    expect(computeUnlocked(['sci', 'award'], edges, isDone).unlocked.get('award')).toBe(true)
  })

  it('simple spec: count=1 时与不带 count 等价', () => {
    const edgesNoCount: Edge[] = [
      { to: 't', prerequisites: ['a'], rule: 'all', specs: [{ kind: 'simple', id: 'a' }] }
    ]
    const edgesCount1: Edge[] = [
      { to: 't', prerequisites: ['a'], rule: 'all', specs: [{ kind: 'simple', id: 'a', count: 1 }] }
    ]
    const isDone = (id: string, _k: number) => id === 'a'
    expect(computeUnlocked(['a', 't'], edgesNoCount, isDone).unlocked.get('t')).toBe(
      computeUnlocked(['a', 't'], edgesCount1, isDone).unlocked.get('t')
    )
  })

  it('group spec: 任选其一（pick=1）', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a', 'b', 'c'],
        rule: 'all',
        specs: [{ kind: 'group', members: ['a', 'b', 'c'], pick: 1 }]
      }
    ]
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['a'])).unlocked.get('t')).toBe(true)
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['c'])).unlocked.get('t')).toBe(true)
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done([])).unlocked.get('t')).toBe(false)
  })

  it('group spec: N 选 K', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a', 'b', 'c', 'd'],
        rule: 'all',
        specs: [{ kind: 'group', members: ['a', 'b', 'c', 'd'], pick: 2 }]
      }
    ]
    expect(computeUnlocked(['a', 'b', 'c', 'd', 't'], edges, done(['a'])).unlocked.get('t')).toBe(false)
    expect(computeUnlocked(['a', 'b', 'c', 'd', 't'], edges, done(['a', 'b'])).unlocked.get('t')).toBe(true)
  })

  it('count spec: need=N 时只有 ≥N 个 done 才满足', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a', 'b', 'c'],
        rule: 'all',
        specs: [{ kind: 'count', members: ['a', 'b', 'c'], need: 2 }]
      }
    ]
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['a'])).unlocked.get('t')).toBe(false)
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['a', 'b'])).unlocked.get('t')).toBe(true)
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['a', 'b', 'c'])).unlocked.get('t')).toBe(true)
  })

  it('count spec: AND-of-specs 与其他 spec 共存', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a', 'b', 'c', 'd'],
        rule: 'all',
        specs: [
          { kind: 'count', members: ['a', 'b'], need: 1 }, // a 或 b
          { kind: 'simple', id: 'c' }, // c 必须
          { kind: 'group', members: ['d'], pick: 1 } // d 必须（单成员 group 退化成 mandatory）
        ]
      }
    ]
    // 缺 c → 锁
    expect(computeUnlocked(['a', 'b', 'c', 'd', 't'], edges, done(['a', 'd'])).unlocked.get('t')).toBe(false)
    // 缺 d → 锁
    expect(computeUnlocked(['a', 'b', 'c', 'd', 't'], edges, done(['a', 'c'])).unlocked.get('t')).toBe(false)
    // 齐 → 解锁
    expect(computeUnlocked(['a', 'b', 'c', 'd', 't'], edges, done(['a', 'c', 'd'])).unlocked.get('t')).toBe(true)
  })

  it('specs 里嵌的 exclude 不算正向 spec（谓词在应用层改写）', () => {
    // 本测试只验证 unlock.ts 不把 exclude 当 yes/no 来算；具体互斥逻辑在 done map 层
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'a' },
          { kind: 'exclude', trigger: 'x', target: 'y', effect: 'disqualifies' }
        ]
      }
    ]
    expect(computeUnlocked(['a', 't'], edges, done(['a'])).unlocked.get('t')).toBe(true)
  })

  it('悬空成员被忽略（group/count/single 均如此）', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['a', 'ghost'],
        rule: 'all',
        specs: [
          { kind: 'count', members: ['a', 'ghost'], need: 1 },
          { kind: 'simple', id: 'ghost2' } // 全悬空，简单前置永远不满足
        ]
      }
    ]
    expect(computeUnlocked(['a', 't'], edges, done(['a'])).unlocked.get('t')).toBe(false)
  })
})

describe('computeUnlocked — exclude 在 isDone 谓词层的改写', () => {
  /**
   * 模拟应用层做法：
   * 1. 收集所有 excludes
   * 2. 对 disqualifies：trigger.done 时把 target 从 done 集合里拿掉
   * 3. 对 satisfies：trigger.done 时把 target 加进 done 集合
   */
  function rewriteIsDone(
    raw: Set<string>,
    excludes: ExcludeSpec[]
  ): (id: string, k: number) => boolean {
    const modified = new Set(raw)
    for (const ex of excludes) {
      if (!raw.has(ex.trigger)) continue
      if (ex.effect === 'disqualifies') modified.delete(ex.target)
      else modified.add(ex.target)
    }
    return (id: string, _k: number) => modified.has(id)
  }

  it('disqualifies: trigger 已 done 时 target 不再算 done → 其做前置时不满足', () => {
    const edges: Edge[] = [
      {
        to: 'mainAward',
        prerequisites: ['namedAward'],
        rule: 'all',
        excludes: [
          { kind: 'exclude', trigger: 'chiefAward', target: 'namedAward', effect: 'disqualifies' }
        ]
      }
    ]
    // 1) 没拿所长：namedAward done → mainAward 解锁
    const excludes = collectExcludes(edges)
    expect(computeUnlocked(['chiefAward', 'namedAward', 'mainAward'], edges, rewriteIsDone(new Set(['namedAward']), excludes)).unlocked.get('mainAward')).toBe(true)
    // 2) 拿了所长：trigger done → namedAward 被 disqualify → mainAward 锁
    expect(computeUnlocked(['chiefAward', 'namedAward', 'mainAward'], edges, rewriteIsDone(new Set(['chiefAward', 'namedAward']), excludes)).unlocked.get('mainAward')).toBe(false)
  })

  it('satisfies: trigger 已 done 时 target 在解锁谓词里视为 done', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['B'],
        rule: 'all',
        excludes: [
          { kind: 'exclude', trigger: 'A', target: 'B', effect: 'satisfies' }
        ]
      }
    ]
    const excludes = collectExcludes(edges)
    // 仅 A done → B 视为 done → t 解锁
    expect(computeUnlocked(['A', 'B', 't'], edges, rewriteIsDone(new Set(['A']), excludes)).unlocked.get('t')).toBe(true)
    // 都没 → 不解锁
    expect(computeUnlocked(['A', 'B', 't'], edges, rewriteIsDone(new Set([]), excludes)).unlocked.get('t')).toBe(false)
  })

  it('多个 excludes 去重（trigger+target+effect 一致视为同一规则）', () => {
    const x: ExcludeSpec = { kind: 'exclude', trigger: 'a', target: 'b', effect: 'disqualifies' }
    const edges: Edge[] = [
      { to: 't1', prerequisites: ['b'], rule: 'all', excludes: [x], specs: [{ kind: 'simple', id: 'b' }] },
      { to: 't2', prerequisites: ['b'], rule: 'all', excludes: [x] }
    ]
    expect(collectExcludes(edges)).toHaveLength(1)
  })
})

describe('computeUnlocked — 兼容性（无 specs/excludes 时行为与旧版一致）', () => {
  it('旧 rule=all 不受新字段影响', () => {
    const edges: Edge[] = [{ to: 't', prerequisites: ['a', 'b'], rule: 'all' }]
    expect(computeUnlocked(['a', 'b', 't'], edges, done(['a'])).unlocked.get('t')).toBe(false)
    expect(computeUnlocked(['a', 'b', 't'], edges, done(['a', 'b'])).unlocked.get('t')).toBe(true)
  })

  it('旧 groups 仍走 AND-of-ORs 路径', () => {
    const edges: Edge[] = [
      { to: 't', prerequisites: ['a', 'b', 'c'], rule: 'all', groups: [['a', 'b']] }
    ]
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['a', 'c'])).unlocked.get('t')).toBe(true)
    expect(computeUnlocked(['a', 'b', 'c', 't'], edges, done(['c'])).unlocked.get('t')).toBe(false)
  })
})

describe('computeUnlocked — group per-member count (v3)', () => {
  /**
   * 模拟 life-tracker 应用层 isDone：对 countable 任务比较 progress.current >= requiredCount；
   * 普通任务只要 id 命中 done set 即视为 done。
   */
  function isDoneWithCounts(
    progress: Record<string, number>,
    rawDone: Set<string>
  ): (id: string, k: number) => boolean {
    return (id: string, k: number): boolean => {
      if (id in progress) return progress[id] >= k
      return rawDone.has(id)
    }
  }

  it('group [{id,count:2}, C] pick=1：B=1 不满足，C 完成时满足', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['B', 'C'],
        rule: 'all',
        specs: [
          {
            kind: 'group',
            members: [{ id: 'B', count: 2 }, { id: 'C' }],
            pick: 1
          }
        ]
      }
    ]
    const isDone = isDoneWithCounts({ B: 1 }, new Set(['C']))
    expect(computeUnlocked(['B', 'C', 't'], edges, isDone).unlocked.get('t')).toBe(true)
  })

  it('group [{id,count:2}, C] pick=1：B=2 时满足（不需要 C）', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['B'],
        rule: 'all',
        specs: [
          {
            kind: 'group',
            members: [{ id: 'B', count: 2 }, { id: 'C' }],
            pick: 1
          }
        ]
      }
    ]
    const isDone = isDoneWithCounts({ B: 2 }, new Set([]))
    expect(computeUnlocked(['B', 'C', 't'], edges, isDone).unlocked.get('t')).toBe(true)
  })

  it('group 旧 ["B","C"] 形态仍按 requiredCount=1 计算（向后兼容）', () => {
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['B', 'C'],
        rule: 'all',
        specs: [{ kind: 'group', members: ['B', 'C'], pick: 1 }]
      }
    ]
    // 普通任务：B 完成即视为 done；requiredCount=1
    expect(computeUnlocked(['B', 'C', 't'], edges, done(['B'])).unlocked.get('t')).toBe(true)
    expect(computeUnlocked(['B', 'C', 't'], edges, done(['C'])).unlocked.get('t')).toBe(true)
  })

  it('AND-of-specs：simple B count=1 AND group [{B,count:2}, C] pick=1 —— 表达用户原例', () => {
    // 用户原例：(B 完成第 1 次) AND ((B 完成第 2 次) OR C 完成)
    const edges: Edge[] = [
      {
        to: 't',
        prerequisites: ['B'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'B', count: 1 },
          { kind: 'group', members: [{ id: 'B', count: 2 }, { id: 'C' }], pick: 1 }
        ]
      }
    ]
    // B=1 且 C 完成 → 解锁（满足 simple B>=1 和 group 中 C）
    expect(computeUnlocked(['B', 'C', 't'], edges, isDoneWithCounts({ B: 1 }, new Set(['C']))).unlocked.get('t')).toBe(true)
    // B=1 但 C 没完成 → 不解锁
    expect(computeUnlocked(['B', 'C', 't'], edges, isDoneWithCounts({ B: 1 }, new Set([]))).unlocked.get('t')).toBe(false)
    // B=2 → 解锁（C 状态无所谓）
    expect(computeUnlocked(['B', 'C', 't'], edges, isDoneWithCounts({ B: 2 }, new Set([]))).unlocked.get('t')).toBe(true)
    // B=0 → 不解锁
    expect(computeUnlocked(['B', 'C', 't'], edges, isDoneWithCounts({ B: 0 }, new Set([]))).unlocked.get('t')).toBe(false)
  })
})

describe('detectCycles — 包含 exclude / specs 的图', () => {
  it('exclude 不形成新边（不参与环检测）', () => {
    // exclude 不会让 to/prereq 出现循环；这里验证 detectCycles 对纯 specs 也能跑通
    const edges: Edge[] = [
      {
        to: 'a',
        prerequisites: ['b'],
        rule: 'all',
        specs: [{ kind: 'simple', id: 'b' }]
      },
      {
        to: 'b',
        prerequisites: ['a'],
        rule: 'all',
        specs: [{ kind: 'simple', id: 'a' }]
      }
    ]
    const cycles = detectCycles(edges)
    expect(cycles.length).toBeGreaterThan(0)
  })
})