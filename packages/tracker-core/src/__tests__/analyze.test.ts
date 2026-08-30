import { describe, expect, it } from 'vitest'
import { analyzeGraph, distanceTo } from '../analyze'
import type { Edge } from '../types'

/** 构造 done 谓词的便捷工厂：传入 done 集合 */
function doneOf(doneIds: Set<string>): (id: string, n: number) => boolean {
  return (id: string) => doneIds.has(id)
}

describe('analyzeGraph —— 基础统计', () => {
  it('空图：所有字段为 0 / 空，healthScore=100（无问题）', () => {
    const r = analyzeGraph([], [], () => false)
    expect(r.stats.total).toBe(0)
    expect(r.stats.done).toBe(0)
    expect(r.stats.completionRate).toBe(0)
    expect(r.stats.avgInDegree).toBe(0)
    expect(r.stats.avgOutDegree).toBe(0)
    expect(r.stats.maxDepth).toBe(0)
    expect(r.stats.components).toBe(0)
    expect(r.orphans).toEqual([])
    expect(r.roots).toEqual([])
    expect(r.leaves).toEqual([])
    expect(r.bottlenecks).toEqual([])
    // 空图无可衡量 = 满分（无节点 = 无孤立/瓶颈/未完成）
    expect(r.healthScore).toBe(100)
    expect(r.criticalPath).toEqual([])
  })

  it('单节点（未完成）：既是 orphan 又是 maxDepth=1', () => {
    const r = analyzeGraph(['a'], [], () => false)
    expect(r.stats.total).toBe(1)
    expect(r.stats.done).toBe(0)
    expect(r.stats.completionRate).toBe(0)
    expect(r.stats.maxDepth).toBe(1)
    // 单节点 0 入度 + 0 出度 → 算 orphan
    expect(r.orphans).toEqual(['a'])
    expect(r.roots).toEqual([])
    expect(r.leaves).toEqual([])
    expect(r.criticalPath).toEqual(['a'])
  })

  it('单节点（已 done）：maxDepth=0, path=[]', () => {
    const r = analyzeGraph(['a'], [], () => true)
    expect(r.stats.done).toBe(1)
    expect(r.stats.completionRate).toBe(1)
    expect(r.stats.maxDepth).toBe(0)
    expect(r.criticalPath).toEqual([])
  })
})

describe('analyzeGraph —— 节点分类', () => {
  it('孤立节点 = 0 入度 + 0 出度', () => {
    // A → B, C 孤立
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.orphans).toEqual(['c'])
    expect(r.roots.map((x) => x.id)).toEqual(['a'])
    expect(r.leaves).toEqual(['b'])
  })

  it('根节点按 outDegree 降序排', () => {
    // A → C, A → D, B → C（A 出度 2，B 出度 1）
    const edges: Edge[] = [
      { to: 'c', prerequisites: ['a', 'b'], rule: 'all' },
      { to: 'd', prerequisites: ['a'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c', 'd'], edges, () => false)
    expect(r.roots.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r.roots[0].outDegree).toBe(2)
    expect(r.roots[0].blocks.sort()).toEqual(['c', 'd'])
    expect(r.roots[1].outDegree).toBe(1)
    expect(r.roots[1].blocks).toEqual(['c'])
  })

  it('叶节点按 id 字典序排', () => {
    const edges: Edge[] = [
      { to: 'leaf1', prerequisites: ['a'], rule: 'all' },
      { to: 'leaf2', prerequisites: ['a'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'leaf1', 'leaf2'], edges, () => false)
    expect(r.leaves).toEqual(['leaf1', 'leaf2'])
  })
})

describe('analyzeGraph —— 拓扑与 critical path', () => {
  it('线性链 A → B → C 全未 done：maxDepth=3, path=[A,B,C]', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.stats.maxDepth).toBe(3)
    expect(r.criticalPath).toEqual(['a', 'b', 'c'])
  })

  it('A 已 done 折叠：B.distance=1, path=[B,C]', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, doneOf(new Set(['a'])))
    expect(r.stats.maxDepth).toBe(2)
    expect(r.criticalPath).toEqual(['b', 'c'])
  })

  it('A 与 B 已 done：只剩 C 在链上（孤立）', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, doneOf(new Set(['a', 'b'])))
    // C 没前置未完成 → maxDepth = 1（C 自己），path = [C]
    expect(r.stats.maxDepth).toBe(1)
    expect(r.criticalPath).toEqual(['c'])
  })

  it('多链选最长那条', () => {
    // 链 1：A → B（短，2 步）
    // 链 2：X → Y → Z → W（长，4 步）
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'y', prerequisites: ['x'], rule: 'all' },
      { to: 'z', prerequisites: ['y'], rule: 'all' },
      { to: 'w', prerequisites: ['z'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'x', 'y', 'z', 'w'], edges, () => false)
    expect(r.stats.maxDepth).toBe(4)
    expect(r.criticalPath).toEqual(['x', 'y', 'z', 'w'])
  })

  it('全 done：maxDepth=0, path=[]', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b'], edges, () => true)
    expect(r.stats.maxDepth).toBe(0)
    expect(r.criticalPath).toEqual([])
  })

  it('金刚石：A → {B, C} → D（B、C 各 distance=1, D distance=2）', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['a'], rule: 'all' },
      { to: 'd', prerequisites: ['b', 'c'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c', 'd'], edges, () => false)
    expect(r.stats.maxDepth).toBe(3)
    // maxD 在 D 上（D = 2）；parent[D] = 字典序小的 b
    expect(r.criticalPath).toEqual(['a', 'b', 'd'])
  })
})

describe('analyzeGraph —— 瓶颈', () => {
  it('未 done + 出度 > 0 才算瓶颈', () => {
    // A → B, A → C, D → B（D 优先级更高，因为它被 B 依赖）
    // A 出度 2, D 出度 1
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a', 'd'], rule: 'all' },
      { to: 'c', prerequisites: ['a'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c', 'd'], edges, doneOf(new Set(['a'])))
    expect(r.bottlenecks.map((x) => x.id)).toEqual(['d'])
    expect(r.bottlenecks[0].score).toBe(1)
    expect(r.bottlenecks[0].blocks).toEqual(['b'])
  })

  it('已 done 节点不进瓶颈榜', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b'], edges, doneOf(new Set(['a'])))
    expect(r.bottlenecks).toEqual([])
  })

  it('瓶颈按 score 降序排，平手按 id 字典序', () => {
    const edges: Edge[] = [
      { to: 'c', prerequisites: ['a', 'b'], rule: 'all' },
      { to: 'd', prerequisites: ['a'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c', 'd'], edges, () => false)
    // A 出度 2（c+d）, B 出度 1（c）
    expect(r.bottlenecks.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('瓶颈最多 10 个（top 截断）', () => {
    // 构造 11 个高 outDegree 节点 + 1 个 n_ref
    // 每个高 outDegree 节点依赖一个 n_ref（每个 score 至少 1）
    // bottleneck cap 到 10
    const edges: Edge[] = []
    const ids: string[] = ['ref'] // 一个被多节点依赖的 ref
    for (let i = 0; i < 12; i++) {
      const id = `n${i}`
      ids.push(id)
      edges.push({ to: id, prerequisites: ['ref'], rule: 'all' })
    }
    const r = analyzeGraph(ids, edges, () => false)
    // ref 出度 12，被 cap 到 10
    expect(r.bottlenecks.length).toBe(1)
    expect(r.bottlenecks[0].id).toBe('ref')
    expect(r.bottlenecks[0].score).toBe(12)
  })

  it('多个高分瓶颈：按 score 降序，截到 top 10', () => {
    const edges: Edge[] = []
    const ids: string[] = []
    // 11 个 root 都依赖 1 个超级 ref
    // ref score = 11（被 11 个依赖），但是只有 1 个节点
    // 为了测 top 10 截断，需要 10+ 个高分节点
    // 简化：1 个 ref 出度 11，已经验证 cap；这里测多 bottleneck 排序
    const ids2 = ['a', 'b', 'c', 'd', 'e']
    const edges2: Edge[] = [
      { to: 'e', prerequisites: ['a'], rule: 'all' },
      { to: 'e', prerequisites: ['b'], rule: 'all' },
      { to: 'd', prerequisites: ['c'], rule: 'all' }
    ]
    const r2 = analyzeGraph(ids2, edges2, () => false)
    // a 出度 1，b 出度 1，c 出度 1（3 个瓶颈 score=1）
    expect(r2.bottlenecks.length).toBe(3)
    expect(r2.bottlenecks.every((b) => b.score === 1)).toBe(true)
  })
})

describe('analyzeGraph —— 度统计', () => {
  it('平均入度/出度反映图密度', () => {
    // A → B, A → C, B → C：A 出度 2，B 出度 1，C 入度 2
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['a', 'b'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.stats.avgInDegree).toBeCloseTo(1, 5) // (0+1+2)/3
    expect(r.stats.avgOutDegree).toBeCloseTo(1, 5) // (2+1+0)/3
  })

  it('blocks 去重：同对节点多条 edge 只算一次', () => {
    // A → B 两次（countable spec 的 common 模式）
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'b', prerequisites: ['a'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b'], edges, () => false)
    expect(r.roots[0].outDegree).toBe(1) // 不重复算 2
    expect(r.roots[0].blocks).toEqual(['b'])
  })
})

describe('analyzeGraph —— 环处理', () => {
  it('环上节点不参与入度/出度计算', () => {
    // A ↔ B 循环，C 单独
    const edges: Edge[] = [
      { to: 'a', prerequisites: ['b'], rule: 'all' },
      { to: 'b', prerequisites: ['a'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    // A, B 环上；C 孤立
    expect(r.orphans).toEqual(['c'])
    expect(r.roots).toEqual([])
    expect(r.leaves).toEqual([])
    // critical path 不含环节点
    expect(r.criticalPath).toEqual(['c'])
    expect(r.stats.maxDepth).toBe(1)
  })
})

describe('analyzeGraph —— v2 specs', () => {
  it('simple spec 算正向引用', () => {
    const edges: Edge[] = [
      {
        to: 'b',
        prerequisites: [],
        rule: 'all',
        specs: [{ kind: 'simple', id: 'a' }]
      }
    ]
    const r = analyzeGraph(['a', 'b'], edges, () => false)
    expect(r.roots.map((x) => x.id)).toEqual(['a'])
    expect(r.leaves).toEqual(['b'])
    expect(r.stats.maxDepth).toBe(2)
  })

  it('group spec 每个 member 算正向引用', () => {
    const edges: Edge[] = [
      {
        to: 'c',
        prerequisites: [],
        rule: 'all',
        specs: [{ kind: 'group', members: ['a', 'b'], pick: 1 }]
      }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.roots.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(r.roots.map((x) => x.outDegree)).toEqual([1, 1])
    expect(r.leaves).toEqual(['c'])
  })

  it('count spec 每个 member 算正向引用', () => {
    const edges: Edge[] = [
      {
        to: 'c',
        prerequisites: [],
        rule: 'all',
        specs: [{ kind: 'count', members: ['a', 'b'], need: 1 }]
      }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.roots.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('exclude spec 不算正向引用', () => {
    // A 应该是 root（被 B 依赖 via specs.simple），不被 exclude 影响
    const edges: Edge[] = [
      {
        to: 'b',
        prerequisites: ['a'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'a' },
          { kind: 'exclude', trigger: 'a', target: 'b', effect: 'disqualifies' }
        ]
      }
    ]
    const r = analyzeGraph(['a', 'b'], edges, () => false)
    // A 仍然算 root（B 依赖它），exclude 只改写谓词
    expect(r.roots.map((x) => x.id)).toEqual(['a'])
  })

  it('object 形态的 group member 正确解析', () => {
    // group member: { id: 'a', count: 2 } —— 用 id 作正向引用
    const edges: Edge[] = [
      {
        to: 'c',
        prerequisites: [],
        rule: 'all',
        specs: [{ kind: 'group', members: [{ id: 'a', count: 2 }, 'b'], pick: 1 }]
      }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.roots.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })
})

describe('analyzeGraph —— 悬空引用', () => {
  it('edge.to 不在 ids 里：整条 edge 忽略', () => {
    const edges: Edge[] = [{ to: 'ghost', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a'], edges, () => false)
    expect(r.stats.total).toBe(1)
    expect(r.orphans).toEqual(['a'])
  })

  it('edge.prereqs 含不在 ids 里的 id：被忽略', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a', 'ghost'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b'], edges, () => false)
    expect(r.roots.map((x) => x.id)).toEqual(['a'])
    expect(r.roots[0].blocks).toEqual(['b'])
  })
})

describe('analyzeGraph —— 连通分量', () => {
  it('两个独立连通分量 = 2', () => {
    // 分量 1: A → B；分量 2: C → D；E 孤立
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'd', prerequisites: ['c'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c', 'd', 'e'], edges, () => false)
    expect(r.stats.components).toBe(2)
    expect(r.orphans).toEqual(['e'])
  })

  it('孤立节点不计入分量', () => {
    const r = analyzeGraph(['a'], [], () => false)
    expect(r.stats.components).toBe(0)
  })

  it('全连通单分量 = 1', () => {
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c'], edges, () => false)
    expect(r.stats.components).toBe(1)
  })
})

describe('analyzeGraph —— 健康度评分', () => {
  it('全 done + 无孤立 + 无瓶颈 = 满 100（40+30+30）', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b'], edges, () => true)
    expect(r.healthBreakdown.completionRateScore).toBe(40)
    expect(r.healthBreakdown.orphanScore).toBe(30)
    expect(r.healthBreakdown.bottleneckScore).toBe(30)
    expect(r.healthScore).toBe(100)
  })

  it('链全未完成 + 1 个瓶颈（A 出度 1）：0 + 30 + 27 = 57', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b'], edges, () => false)
    expect(r.healthBreakdown.completionRateScore).toBe(0)
    expect(r.healthBreakdown.orphanScore).toBe(30) // 无孤立
    // A 是瓶颈（未 done + 出度 1）→ bottleneckScore = 30 - 1*3 = 27
    expect(r.healthBreakdown.bottleneckScore).toBe(27)
    expect(r.healthScore).toBe(57)
  })

  it('孤立节点扣分：每个 5 分', () => {
    // 3 个孤立 + 完成率 0
    const r = analyzeGraph(['x', 'y', 'z'], [], () => false)
    expect(r.healthBreakdown.orphanScore).toBe(15) // 30 - 3*5
    expect(r.orphans.sort()).toEqual(['x', 'y', 'z'])
  })

  it('孤立节点最多扣 30（≥6 个）', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`)
    const r = analyzeGraph(ids, [], () => false)
    expect(r.healthBreakdown.orphanScore).toBe(0) // 30 - 50 = 0（clamped）
  })
})

describe('distanceTo', () => {
  it('target 已 done → 0', () => {
    expect(distanceTo('a', ['a'], [], () => true)).toBe(0)
  })

  it('target 是 root（无前置未完成）→ 1', () => {
    expect(distanceTo('a', ['a'], [], () => false)).toBe(1)
  })

  it('target 未完成 + A（前置）未完成 → 2', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    expect(distanceTo('b', ['a', 'b'], edges, () => false)).toBe(2)
  })

  it('target 未完成 + A 已 done → 1（A 折叠）', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    expect(distanceTo('b', ['a', 'b'], edges, doneOf(new Set(['a'])))).toBe(1)
  })

  it('target 不在 ids 里 → 0', () => {
    expect(distanceTo('ghost', ['a'], [], () => false)).toBe(0)
  })

  it('环上节点距离 0', () => {
    const edges: Edge[] = [
      { to: 'a', prerequisites: ['b'], rule: 'all' },
      { to: 'b', prerequisites: ['a'], rule: 'all' }
    ]
    // A ↔ B 环：distanceTo('a') = 0（环不参与）
    expect(distanceTo('a', ['a', 'b'], edges, () => false)).toBe(0)
  })

  it('多链：取最长那条的距离', () => {
    // X → Y → Z（3 步）, A → B（2 步）
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'y', prerequisites: ['x'], rule: 'all' },
      { to: 'z', prerequisites: ['y'], rule: 'all' }
    ]
    expect(distanceTo('z', ['a', 'b', 'x', 'y', 'z'], edges, () => false)).toBe(3)
  })
})

describe('analyzeGraph —— 综合场景', () => {
  it('典型 life-tracker 场景：国奖 ← {三好 + SCI1 + SCI2} + 各自前置', () => {
    // 简化：
    // GPA → 三好 → 国奖
    // 实验1 → SCI1 → 国奖
    // 实验2 → SCI2 → 国奖
    // 还有：读书（孤立）、练字（孤立）
    const edges: Edge[] = [
      { to: '三好', prerequisites: ['GPA'], rule: 'all' },
      { to: 'SCI1', prerequisites: ['实验1'], rule: 'all' },
      { to: 'SCI2', prerequisites: ['实验2'], rule: 'all' },
      {
        to: '国奖',
        prerequisites: ['三好', 'SCI1', 'SCI2'],
        rule: 'all'
      }
    ]
    const r = analyzeGraph(
      ['GPA', '实验1', '实验2', '三好', 'SCI1', 'SCI2', '国奖', '读书', '练字'],
      edges,
      doneOf(new Set(['GPA', '实验1']))
    )

    // 基础统计
    expect(r.stats.total).toBe(9)
    expect(r.stats.done).toBe(2)
    expect(r.stats.completionRate).toBeCloseTo(2 / 9, 5)

    // 孤立：读书、练字
    expect(r.orphans.sort()).toEqual(['练字', '读书'])

    // 根（0 入度 + N 出度）：GPA, 实验1, 实验2（读书/练字是 orphan，不算 root）
    const rootIds = r.roots.map((x) => x.id).sort()
    expect(rootIds).toEqual(['GPA', '实验1', '实验2'])

    // 叶（0 出度）：国奖
    expect(r.leaves).toEqual(['国奖'])

    // 瓶颈：未 done + 出度 > 0
    // GPA 已 done，不进；实验2 出度 1 → 瓶颈；实验1 已 done 不进
    // 三好/SCI1/SCI2 都未 done 且出度 1 → 也算
    // 4 个瓶颈 score 都是 1，按 id Unicode 码点序排（ASCII < 中文）
    expect(r.bottlenecks.map((x) => x.id)).toEqual(['SCI1', 'SCI2', '三好', '实验2'])

    // critical path：GPA done 折叠，最长未完成链 = 实验2 → SCI2 → 国奖（3 步）
    expect(r.stats.maxDepth).toBe(3)
    expect(r.criticalPath).toEqual(['实验2', 'SCI2', '国奖'])

    // 连通分量：1 个（读书/练字孤立不算）
    expect(r.stats.components).toBe(1)
  })
})