// 回归测试：GraphView 的链接 / refCount 推导不再直读 e.prerequisites，
// 而是与 computeUnlocked 的路径对齐 —— 按 specs / groups 拆边。
//
// 历史 bug：
//   - specs=[simple A, group(B,C)] + 兜底后 prerequisites=[A,B,C]：
//     旧实现把 3 个都画成边，多出废链接（A→target 与 group 重叠）。
//   - specs=[simple A] + 兜底后 prerequisites=[A,B]：
//     旧实现把 B 也画成边，但 B 不在 specs 里（只是「旧裸 id 兜底」遗留），实际不是前置。
//   - 旧 AND-of-ORs（groups）下 mandatory 与 group member 视觉无差。
//   - countable 任务被多次添加为 simple spec（每次 count 不同）：
//     旧实现按 specs 1:1 画边 → 同一 source→target N 条平行边，d3-force-link 倍增吸力
//     把两端拉近 / 渲染重叠 / refCount 膨胀。

import { describe, expect, it } from 'vitest'
import type { Edge, PrereqSpec } from '@core'
import { groupMemberId } from '@core'

/** 镜像 GraphView.tsx 的 deriveLinks —— 保持这个测试不依赖 renderer 模块 */
function deriveLinks(edge: Edge): { source: string; target: string; rule: string; threshold?: number }[] {
  const mkLink = (source: string) => ({
    source,
    target: edge.to,
    rule: edge.rule,
    threshold: edge.threshold
  })
  const specs: PrereqSpec[] = edge.specs ?? []
  const positiveSpecs = specs.filter((s) => s.kind !== 'exclude')

  const collected: { source: string; target: string; rule: string; threshold?: number }[] = []
  if (positiveSpecs.length > 0) {
    for (const s of positiveSpecs) {
      if (s.kind === 'simple') collected.push(mkLink(s.id))
      else if (s.kind === 'group') {
        for (const m of s.members) collected.push(mkLink(groupMemberId(m)))
      } else if (s.kind === 'count') {
        for (const id of s.members) collected.push(mkLink(id))
      }
    }
  } else if (edge.groups && edge.groups.length > 0) {
    const inGroup = new Set<string>(edge.groups.flat())
    for (const p of edge.prerequisites) {
      if (!inGroup.has(p)) collected.push(mkLink(p))
    }
    for (const g of edge.groups) for (const id of g) collected.push(mkLink(id))
  } else {
    for (const p of edge.prerequisites) collected.push(mkLink(p))
  }

  // (source, target) 去重——镜像 GraphView 的画图层卸载逻辑。
  // count>1 的 simple spec / 多 group 重叠成员 / count spec 重叠成员
  // 都会在这里被合成 1 条边，避免平行边 + refCount 膨胀。
  const seen = new Set<string>()
  return collected.filter((l) => {
    const key = `${l.source}->${edge.to}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

describe('deriveLinks — specs 路径（v2/v3）', () => {
  it('simple spec → 1 条边', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['A'],
      rule: 'all',
      specs: [{ kind: 'simple', id: 'A' }]
    }
    expect(deriveLinks(e).map((l) => l.source)).toEqual(['A'])
  })

  it('group spec → N 条候选边（pick=1 等价任选其一）', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['B', 'C'],
      rule: 'all',
      specs: [{ kind: 'group', members: ['B', 'C'], pick: 1 }]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['B', 'C'])
  })

  it('group spec per-member count 形态 → 仅按 id 拆边（不带 count）', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['B', 'C'],
      rule: 'all',
      specs: [{ kind: 'group', members: [{ id: 'B', count: 2 }, { id: 'C' }], pick: 1 }]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['B', 'C'])
  })

  it('count spec → N 条候选边', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['a', 'b', 'c'],
      rule: 'all',
      specs: [{ kind: 'count', members: ['a', 'b', 'c'], need: 2 }]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['a', 'b', 'c'])
  })

  it('exclude spec → 不画边', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'X'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'A' },
        { kind: 'exclude', trigger: 'X', target: 'A', effect: 'disqualifies' }
      ]
    }
    // 只有 simple A 画边；exclude 不画
    expect(deriveLinks(e).map((l) => l.source)).toEqual(['A'])
  })

  it('specs 含 exclude 但没正向 spec → 回退到 prerequisites 直读', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['A'],
      rule: 'all',
      specs: [{ kind: 'exclude', trigger: 'X', target: 'A', effect: 'disqualifies' }]
    }
    // exclude-only 时 positiveSpecs 为空 → 走 legacy prerequisites 路径
    expect(deriveLinks(e).map((l) => l.source)).toEqual(['A'])
  })

  it('specs 路径下：prerequisites 里的「旧裸 id 兜底」遗留**不**画边', () => {
    // 旧实现会按 prerequisites 把 B 也画上，但 B 不在 specs 里、不是真前置
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B'],
      rule: 'all',
      specs: [{ kind: 'simple', id: 'A' }]
    }
    expect(deriveLinks(e).map((l) => l.source)).toEqual(['A'])
  })

  it('多条 simple spec 同时存在 → 每条各 1 条边', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B', 'C'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'A' },
        { kind: 'simple', id: 'B' },
        { kind: 'simple', id: 'C' }
      ]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B', 'C'])
  })

  it('混合 spec 形态：simple + group + exclude', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B', 'C', 'X'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'A' },
        { kind: 'group', members: ['B', 'C'], pick: 1 },
        { kind: 'exclude', trigger: 'X', target: 'A', effect: 'disqualifies' }
      ]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('deriveLinks — 旧 AND-of-ORs（groups）', () => {
  it('有 group 时：mandatory prereqs + 各 group members', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['a', 'b', 'c'],
      rule: 'all',
      groups: [['a', 'b']]
    }
    // mandatory: c（在 group 外的）
    // group members: a, b
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['a', 'b', 'c'])
  })

  it('无 mandatory + 多个 group → 仅 group members', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['a', 'b', 'c', 'd'],
      rule: 'all',
      groups: [['a', 'b'], ['c', 'd']]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('groups 空数组 → 视为无 groups，回退到 prerequisites', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['a', 'b'],
      rule: 'all',
      groups: []
    }
    expect(deriveLinks(e).map((l) => l.source)).toEqual(['a', 'b'])
  })
})

describe('deriveLinks — 纯旧数据（无 specs 无 groups）', () => {
  it('直读 prerequisites', () => {
    const e: Edge = { to: 'T', prerequisites: ['A', 'B'], rule: 'all' }
    expect(deriveLinks(e).map((l) => l.source)).toEqual(['A', 'B'])
  })

  it('any_of + threshold 也保留在每条 link 上', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B', 'C'],
      rule: 'any_of',
      threshold: 2
    }
    const ls = deriveLinks(e)
    expect(ls).toHaveLength(3)
    for (const l of ls) {
      expect(l.rule).toBe('any_of')
      expect(l.threshold).toBe(2)
    }
  })
})

describe('deriveLinks — 与 computeUnlocked 语义对齐（解锁一致性）', () => {
  // 关键回归：图里画的边必须对应 computeUnlocked 实际会检查的前置集合。
  // 否则会出现"边画了但解锁用不到 / 边没画但解锁要看"的视觉/语义错位。
  it('specs=[group(B,C)] + 兜底 prerequisites=[B,C,D] → 只画 B,C（D 不画）', async () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['B', 'C', 'D'],
      rule: 'all',
      specs: [{ kind: 'group', members: ['B', 'C'], pick: 1 }]
    }
    // D 在 prerequisites 但不在 specs 里 → 不画
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['B', 'C'])
  })
})

describe('deriveLinks — (source, target) 去重（2026-08 修复）', () => {
  // v3 起，countable 任务可能被同一 target 多次添加为 simple spec（每次 count 不同），
  // 在 specs=[{simple B count=1}, {simple B count=2}, ...] 下沿用旧实现会画 N 条
  // 同 source→target 平行边 → d3-force-link 倍增向心力让节点挤成团 / refCount 膨胀。
  // 该组测试验证：(source, target) 唯一确定 1 条边；computeUnlocked 走 specs 全集
  // 不受影响，所以"解锁语义"和"画图层语义"在加载多次 spec 时解耦。

  it('多次 simple spec 同一 id 不同 count → 只画 1 条边', () => {
    const e: Edge = {
      to: 'T',
      prerequisites: ['B'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'B', count: 1 },
        { kind: 'simple', id: 'B', count: 2 },
        { kind: 'simple', id: 'B', count: 3 }
      ]
    }
    const ls = deriveLinks(e)
    expect(ls).toHaveLength(1)
    expect(ls[0].source).toBe('B')
    expect(ls[0].target).toBe('T')
  })

  it('两次 simple spec 同一 id 同 count → 仍只画 1 条边（防御重复添加同 count）', () => {
    // 即使数据有重复（异常 / 迁移期），不应画 2 条平行边
    const e: Edge = {
      to: 'T',
      prerequisites: ['B'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'B', count: 2 },
        { kind: 'simple', id: 'B', count: 2 }
      ]
    }
    expect(deriveLinks(e)).toHaveLength(1)
  })

  it('simple + group 出现同 id → 去重（不画两条平行边）', () => {
    // A 既是 simple spec，又是 group 的成员
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'A' },
        { kind: 'group', members: ['A', 'B'], pick: 1 }
      ]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B'])
  })

  it('group spec 含 per-member count 同 id 重复 → 去重', () => {
    // 异常 / 迁移期：group.members 出现 [{id:A, count:1}, {id:A}, ...]
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B'],
      rule: 'all',
      specs: [
        { kind: 'group', members: [{ id: 'A', count: 1 }, { id: 'A' }, { id: 'B' }], pick: 2 }
      ]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B'])
  })

  it('count spec 含相同 id 重复成员 → 去重', () => {
    // 异常 / 迁移期：count spec members 含同 id
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B'],
      rule: 'all',
      specs: [{ kind: 'count', members: ['A', 'A', 'B'], need: 2 }]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B'])
  })

  it('旧 AND-of-ORs：同一 id 出现在多个 groups → 去重', () => {
    // data 异常：groups=[['A','B'], ['A','C']]
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B', 'C'],
      rule: 'all',
      groups: [['A', 'B'], ['A', 'C']]
    }
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B', 'C'])
  })

  it('多 spec + 多 group 同时出现重复 source → 只画一条', () => {
    // 组合 worst case：simple + group + count 都引用 A；A 还在两个 group 里
    const e: Edge = {
      to: 'T',
      prerequisites: ['A', 'B', 'C', 'X'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'A' },
        { kind: 'group', members: ['A', 'B'], pick: 1 },
        { kind: 'count', members: ['A', 'C', 'X'], need: 2 }
      ],
      groups: [['A', 'X']]
    }
    // 期望：A 出现一次，B/C/X 各一次 → 4 条边
    expect(deriveLinks(e).map((l) => l.source).sort()).toEqual(['A', 'B', 'C', 'X'])
  })

  it('解锁语义不受画图层去重影响（computedUnlocked 仍按 specs 全集判定）', () => {
    // bug 留档：曾担心去重会让"同 id 不同 count"表达"B 既要 1 次又要 2 次"被破坏。
    // 实际上：computeUnlocked 用 specs 全集调 isDone，本测试只验证画图层不去修改 specs。
    const edgeWithDupes: Edge = {
      to: 'T',
      prerequisites: ['B'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'B', count: 1 },
        { kind: 'simple', id: 'B', count: 2 }
      ]
    }
    expect(edgeWithDupes.specs).toHaveLength(2) // specs 全集保留
    expect(deriveLinks(edgeWithDupes)).toHaveLength(1) // 画图层去重为一条
  })
})
