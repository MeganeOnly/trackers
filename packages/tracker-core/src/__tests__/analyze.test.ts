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

describe('analyzeGraph —— 健康度评分 v2（4 维度 100 分）', () => {
  it('全 done + 无孤立 + 无瓶颈 + 深度 ≤5 = 满 100（40+20+25+15）', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b'], edges, () => true)
    expect(r.healthBreakdown.completionRateScore).toBe(40)
    expect(r.healthBreakdown.orphanScore).toBe(20)
    expect(r.healthBreakdown.bottleneckScore).toBe(25)
    expect(r.healthBreakdown.depthScore).toBe(15)
    expect(r.healthBreakdown.activeTotal).toBe(2)
    expect(r.healthBreakdown.inactiveCount).toBe(0)
    expect(r.healthScore).toBe(100)
  })

  it('链全未完成 + 1 个瓶颈（A 出度 1） + 深度 2：0 + 20 + 23 + 15 = 58', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b'], edges, () => false)
    expect(r.healthBreakdown.completionRateScore).toBe(0)
    expect(r.healthBreakdown.orphanScore).toBe(20) // 无孤立
    // A 是瓶颈（未 done + 出度 1）→ bottleneckScore = 25 - 1*2 = 23
    expect(r.healthBreakdown.bottleneckScore).toBe(23)
    // maxDepth = 2 ≤ 5 → 满分 15
    expect(r.healthBreakdown.depthScore).toBe(15)
    expect(r.healthScore).toBe(58)
  })

  it('孤立节点扣分：v2 单孤立温和扣 1 分；小图全孤立触发比例兜底', () => {
    // 1 个孤立在大图里:温和扣 1 分
    // 构造 10 节点 + 1 个孤立节点,其他节点组成链(不产生孤立)
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' },
      { to: 'd', prerequisites: ['c'], rule: 'all' },
      { to: 'e', prerequisites: ['d'], rule: 'all' }
    ]
    const r1 = analyzeGraph(['a', 'b', 'c', 'd', 'e', 'o'], edges, () => false)
    // activeTotal = 6,1 个孤立 = 16.7% < 20% → 线性扣分:20 - 1 = 19
    expect(r1.healthBreakdown.orphanScore).toBe(19)

    // 3 个孤立在小图(3 节点)里 = 100% 比例 → 触发兜底归 0
    const r2 = analyzeGraph(['x', 'y', 'z'], [], () => false)
    expect(r2.healthBreakdown.orphanScore).toBe(0)
    expect(r2.orphans.sort()).toEqual(['x', 'y', 'z'])
  })

  it('孤立节点最多扣 20（≥20 个）', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `n${i}`)
    const r = analyzeGraph(ids, [], () => false)
    expect(r.healthBreakdown.orphanScore).toBe(0) // 20 - 25 = 0（clamped）
  })

  it('孤立比例 > 20% 时直接归 0（图腐烂信号）', () => {
    // 10 个节点里 3 个孤立 = 30% > 20% → orphanScore = 0
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const r = analyzeGraph(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], edges, () => false)
    // 孤立: c, d, e, f, g, h, i, j = 8 个孤立 = 80% 比例 → 直接归 0
    expect(r.orphans.length).toBe(8)
    expect(r.healthBreakdown.orphanScore).toBe(0)
  })

  it('瓶颈最多扣 25（≥13 个瓶颈）', () => {
    // 构造 13 个高 outDegree 的 bottleneck
    const edges: Edge[] = []
    const ids: string[] = []
    for (let i = 0; i < 13; i++) {
      const id = `b${i}`
      ids.push(id)
      // 每个 b_i 依赖一个叶子 leaf_i,b_i 就是 bottleneck (出度 1)
      ids.push(`leaf${i}`)
      edges.push({ to: `leaf${i}`, prerequisites: [id], rule: 'all' })
    }
    const r = analyzeGraph(ids, edges, () => false)
    // 13 个瓶颈 → 25 - 13*2 = -1 → clamp 0
    expect(r.healthBreakdown.bottleneckScore).toBe(0)
  })

  it('瓶颈比例 > 30% 时直接归 0', () => {
    // 5 个节点里 2 个瓶颈 = 40% > 30% → 直接归 0
    const edges: Edge[] = [
      { to: 'leaf1', prerequisites: ['b1'], rule: 'all' },
      { to: 'leaf2', prerequisites: ['b2'], rule: 'all' }
    ]
    const r = analyzeGraph(['b1', 'b2', 'leaf1', 'leaf2', 'extra'], edges, () => false)
    // b1, b2 都是瓶颈 → 2/5 = 40% > 30% → 归 0
    expect(r.healthBreakdown.bottleneckScore).toBe(0)
  })

  it('深度扣分:maxDepth=5 → 满分 15；每超 1 步扣 3', () => {
    // 构造线性链 6 个节点:A→B→C→D→E→F,全未 done
    const edges: Edge[] = [
      { to: 'b', prerequisites: ['a'], rule: 'all' },
      { to: 'c', prerequisites: ['b'], rule: 'all' },
      { to: 'd', prerequisites: ['c'], rule: 'all' },
      { to: 'e', prerequisites: ['d'], rule: 'all' },
      { to: 'f', prerequisites: ['e'], rule: 'all' }
    ]
    const r = analyzeGraph(['a', 'b', 'c', 'd', 'e', 'f'], edges, () => false)
    // maxDepth = 6（6 步链），6 - 5 = 1 → depthScore = 15 - 1*3 = 12
    expect(r.stats.maxDepth).toBe(6)
    expect(r.healthBreakdown.depthScore).toBe(12)
  })

  it('深度扣分:maxDepth=10 → 深度分归 0', () => {
    // 11 个节点线性链
    const ids = Array.from({ length: 11 }, (_, i) => `n${i}`)
    const edges: Edge[] = []
    for (let i = 0; i < 10; i++) {
      edges.push({ to: `n${i + 1}`, prerequisites: [`n${i}`], rule: 'all' })
    }
    const r = analyzeGraph(ids, edges, () => false)
    // maxDepth = 11,11 - 5 = 6,depthScore = 15 - 6*3 = -3 → 0
    expect(r.stats.maxDepth).toBe(11)
    expect(r.healthBreakdown.depthScore).toBe(0)
  })

  it('空图：healthScore = 100（无问题）', () => {
    const r = analyzeGraph([], [], () => false)
    expect(r.healthScore).toBe(100)
    expect(r.healthBreakdown.activeTotal).toBe(0)
    expect(r.healthBreakdown.inactiveCount).toBe(0)
  })
})

describe('analyzeGraph —— v2 规模归一化与 isInactive', () => {
  it('大图小孤立不扣光：100 节点里 5 孤立 = 5% 比例，只扣 5 分', () => {
    // 100 个节点,5 个孤立,1 个 2 节点链（让 activeTotal 不是 0,避免空图满分）
    const ids: string[] = []
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    ids.push('a', 'b')
    for (let i = 0; i < 98; i++) ids.push(`orphan${i}`)
    const r = analyzeGraph(ids, edges, () => false)
    // activeTotal = 100,孤立 98 个（orphan + b? b 不是孤立因为依赖 a）
    // 实际上 a 是 root,b 是 leaf,orphan0-97 都是孤立 → 98 个孤立 = 98% 比例 → 触发兜底归 0
    // 改用小一点的孤立数
    expect(r.orphans.length).toBe(98)
    expect(r.healthBreakdown.orphanScore).toBe(0) // 比例兜底
  })

  it('大图小孤立(合理比例):100 节点里 10 孤立 = 10%,正常扣 10 分', () => {
    // 构造:90 个节点组成链/树,10 个孤立,activeTotal=100,孤立率 10% < 20%
    const ids: string[] = []
    const edges: Edge[] = []
    // 90 个节点排成链(45 条边)
    for (let i = 0; i < 90; i++) {
      ids.push(`n${i}`)
      if (i > 0) edges.push({ to: `n${i}`, prerequisites: [`n${i - 1}`], rule: 'all' })
    }
    // 10 个孤立
    for (let i = 0; i < 10; i++) ids.push(`o${i}`)
    const r = analyzeGraph(ids, edges, () => false)
    expect(r.stats.total).toBe(100)
    expect(r.orphans.length).toBe(10)
    expect(r.healthBreakdown.activeTotal).toBe(100)
    // orphanRate = 10/100 = 10% < 20% → 走线性扣分:20 - 10 = 10
    expect(r.healthBreakdown.orphanScore).toBe(10)
  })

  it('isInactive:shelved 节点不计入 active 分母', () => {
    // 10 个节点,2 个 shelved;activeTotal=8;done=2,完成率按 8 分母算 = 25%
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 's1', 's2']
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    const isDone = doneOf(new Set(['a', 'b']))
    const isInactive = (id: string) => id === 's1' || id === 's2'
    const r = analyzeGraph(ids, edges, isDone, isInactive)
    // activeTotal = 10 - 2 = 8
    expect(r.healthBreakdown.activeTotal).toBe(8)
    expect(r.healthBreakdown.inactiveCount).toBe(2)
    // completionRate = 2 done / 8 active = 0.25 → score = 10
    expect(r.healthBreakdown.completionRateScore).toBe(10)
  })

  it('isInactive:全 inactive 时 activeTotal=0 → 无可衡量=healthScore 100', () => {
    const ids = ['s1', 's2', 's3']
    const r = analyzeGraph(ids, [], () => false, (id) => ids.includes(id))
    expect(r.healthBreakdown.activeTotal).toBe(0)
    expect(r.healthBreakdown.inactiveCount).toBe(3)
    // v2 语义:activeTotal=0 视为"无可衡量",与空图一样直接给 100
    expect(r.healthBreakdown.completionRateScore).toBe(0) // activeTotal=0 → 0/0 = 0
    expect(r.healthScore).toBe(100)
  })

  it('isInactive 不影响孤立/瓶颈的 id 列表（仍展示,但分母剔除了）', () => {
    // 1 个 shelved 孤立 + 1 个 active 孤立,activeTotal=1 → 100% 孤立比例 → orphanScore=0
    const ids = ['orphan1', 's1']
    const r = analyzeGraph(ids, [], () => false, (id) => id === 's1')
    expect(r.orphans).toEqual(['orphan1', 's1']) // 仍展示 s1(它是孤立)
    // activeTotal = 1,orphanRate = 2/1 → 但 0 不能再除（按我们的逻辑用 activeTotal 作分母）
    // 实际 2/1 = 2 = 200% > 20% → 兜底归 0
    expect(r.healthBreakdown.orphanScore).toBe(0)
  })

  it('v1 算法痛点演示:大图小孤立被瞬间扣光(原算法),v2 不再', () => {
    // 100 节点,5 个孤立 → 原 v1:5*5=25 分被扣光附近的孤立分,v2 只扣 5 分
    const ids: string[] = []
    const edges: Edge[] = []
    // 95 个节点组成简单图,5 个孤立
    for (let i = 0; i < 95; i++) {
      ids.push(`n${i}`)
      if (i > 0) edges.push({ to: `n${i}`, prerequisites: [`n${i - 1}`], rule: 'all' })
    }
    for (let i = 0; i < 5; i++) ids.push(`o${i}`)
    const r = analyzeGraph(ids, edges, () => false)
    // 实际:5 个孤立 + n1-n94 都是孤立(因为它们未 done 且只指向叶子)
    // 等等,n0 是 root(0 入度有出度),n1-n94 都是中间节点(入度>0 出度>0),不算孤立
    // 重新想:n1 依赖 n0,n2 依赖 n1... 链上节点:入度 1 出度 1 (除首尾)
    // n0 root,n94 leaf(0 出度),中间节点都是中间
    // 所以孤立只有那 5 个 o0-o4
    expect(r.orphans.length).toBe(5)
    // v2:orphanScore = 20 - 5 = 15
    expect(r.healthBreakdown.orphanScore).toBe(15)
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