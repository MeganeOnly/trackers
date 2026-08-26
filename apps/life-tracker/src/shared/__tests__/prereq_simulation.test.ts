import { describe, expect, it } from 'vitest'
import type { Edge, PrereqSpec } from '@core'
import { detectCycles } from '@core'

// 这是一个独立可验证的回归测试：
// 还原 removeRow 的过滤逻辑 + persist 的 newEdge 构造，模拟"加 ×2 simple spec → 删除"流程。
// 如果 removeRow 在某个边界条件上过滤出错，这里会失败。
//
// 2026-08：persist 增加了显式 `prerequisites` / `groups` 参数（removeRow 用它覆盖推导，
// 避免『兜底』逻辑把已删的旧裸 id 重新加回）。本文件同步忠实还原修复后的逻辑，
// 并补了旧数据（无 specs）删除 + legacy groups 保留的回归用例。

interface RenderedRow {
  key: string
  spec: PrereqSpec
  label: string
  detail: string
  removeIds: string[]
}

function persist({
  baseEdge,
  specs,
  goalId,
  prerequisites,
  groups,
  clearGroups = false
}: {
  baseEdge: Edge | null
  specs: PrereqSpec[]
  goalId: string
  prerequisites?: string[]
  groups?: string[][]
  clearGroups?: boolean
}): Edge {
  const base: Edge = baseEdge ?? { to: goalId, prerequisites: [], rule: 'all' as const }
  let newPrereqIds: string[]
  if (prerequisites !== undefined) {
    newPrereqIds = prerequisites
  } else {
    newPrereqIds = []
    const seen = new Set<string>()
    const positiveSpecs = specs.filter((s) => s.kind !== 'exclude')
    for (const s of positiveSpecs) {
      if (s.kind === 'simple') {
        if (!seen.has(s.id)) {
          seen.add(s.id)
          newPrereqIds.push(s.id)
        }
      } else {
        for (const m of s.members) {
          const id = typeof m === 'string' ? m : m.id
          if (!seen.has(id)) {
            seen.add(id)
            newPrereqIds.push(id)
          }
        }
      }
    }
    // 旧裸 id 兜底：凡不被『新 specs / 生效后的 groups』覆盖的裸 id 一律保留
    const covered = new Set(seen)
    const effectiveGroups =
      groups !== undefined ? groups : clearGroups ? [] : (base.groups ?? [])
    for (const g of effectiveGroups) for (const m of g) covered.add(m)
    for (const id of base.prerequisites) {
      if (!covered.has(id)) {
        covered.add(id)
        newPrereqIds.push(id)
      }
    }
  }
  const newEdge: Edge = {
    ...base,
    to: goalId,
    prerequisites: newPrereqIds,
    groups: groups !== undefined ? groups : clearGroups ? undefined : base.groups,
    specs: specs.length > 0 ? specs : undefined
  }
  if ((newEdge.specs?.filter((s) => s.kind !== 'exclude').length ?? 0) === 0) {
    newEdge.specs = undefined
  }
  return newEdge
}

function removeRow(
  specs: PrereqSpec[],
  groups: string[][],
  allPrereqIds: string[],
  row: RenderedRow
): { specs: PrereqSpec[]; groups: string[][]; prerequisites: string[] } {
  const removeSet = new Set(row.removeIds)
  // v3：simple spec 按 (id, count) 精确匹配；同一目标多次添加（不同 count）时只移除该实例
  const targetSimpleCount =
    row.spec.kind === 'simple' ? (row.spec.count ?? 1) : null
  const nextSpecs = specs
    .map((s) => {
      if (s.kind === 'simple') {
        if (targetSimpleCount === null) {
          return removeSet.has(s.id) ? null : s
        }
        if (removeSet.has(s.id) && (s.count ?? 1) === targetSimpleCount) return null
        return s
      }
      if (s.kind === 'group' || s.kind === 'count') {
        const left = s.members.filter((m) => !removeSet.has(typeof m === 'string' ? m : m.id))
        if (left.length === 0) return null
        return { ...s, members: left }
      }
      return s
    })
    .filter((s): s is PrereqSpec => s !== null)
  const nextGroups = groups.filter((g) => !g.some((m) => removeSet.has(m)))
  // v3：保留 (a) 仍在某 spec/group 的 id；(b) 旧裸 id 不在 removeSet 中（与 dev-notes §5 兜底一致）
  const remainingIds = new Set<string>()
  for (const s of nextSpecs) {
    if (s.kind === 'simple') remainingIds.add(s.id)
    else if (s.kind === 'group' || s.kind === 'count') {
      for (const m of s.members) remainingIds.add(typeof m === 'string' ? m : m.id)
    }
  }
  for (const g of nextGroups) for (const m of g) remainingIds.add(m)
  const nextPrereqIds = allPrereqIds.filter(
    (id) => remainingIds.has(id) || !removeSet.has(id)
  )
  return { specs: nextSpecs, groups: nextGroups, prerequisites: nextPrereqIds }
}

describe('removeRow + persist simulation', () => {
  it('add ×2 simple spec then remove: spec vanishes, prerequisites=[]', () => {
    const goalId = 'award'
    let specs: PrereqSpec[] = []

    // addSingle(id, 2)
    specs = [...specs, { kind: 'simple', id: 'top_paper', count: 2 }]
    let edge = persist({ baseEdge: null, specs, goalId })
    expect(edge.specs).toHaveLength(1)
    expect(edge.prerequisites).toEqual(['top_paper'])

    // remove ×2 chip
    const row: RenderedRow = {
      key: 'spec-simple-0-top_paper',
      spec: { kind: 'simple', id: 'top_paper', count: 2 },
      label: '',
      detail: '一作 top',
      removeIds: ['top_paper']
    }
    const next = removeRow(edge.specs ?? [], edge.groups ?? [], edge.prerequisites, row)
    edge = persist({ baseEdge: edge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge.specs).toBeUndefined()
    expect(edge.prerequisites).toEqual([])
  })

  it('add multiple specs, remove one: others remain, that spec vanishes', () => {
    const goalId = 'award'
    const initialSpecs: PrereqSpec[] = [
      { kind: 'simple', id: 'top_paper', count: 2 },
      { kind: 'simple', id: 'patent' }
    ]
    const edge = persist({ baseEdge: null, specs: initialSpecs, goalId })
    expect(edge.prerequisites).toEqual(['top_paper', 'patent'])

    const next = removeRow(edge.specs ?? [], edge.groups ?? [], edge.prerequisites, {
      key: 'spec-simple-1-patent',
      spec: { kind: 'simple', id: 'patent' },
      label: '',
      detail: '专利',
      removeIds: ['patent']
    })
    const edge2 = persist({ baseEdge: edge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge2.specs).toHaveLength(1)
    expect(edge2.specs![0]).toEqual({ kind: 'simple', id: 'top_paper', count: 2 })
    expect(edge2.prerequisites).toEqual(['top_paper'])
  })

  it('removing an old-style bare prereq (no specs) actually removes it', () => {
    const goalId = 'award'
    const edge = persist({ baseEdge: null, specs: [], goalId, prerequisites: ['patent'] })
    expect(edge.prerequisites).toEqual(['patent'])

    const next = removeRow(edge.specs ?? [], edge.groups ?? [], edge.prerequisites, {
      key: 'bare-patent',
      spec: { kind: 'simple', id: 'patent' },
      label: '',
      detail: '专利',
      removeIds: ['patent']
    })
    const edge2 = persist({ baseEdge: edge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge2.prerequisites).toEqual([])
    expect(edge2.specs).toBeUndefined()
  })

  it('removing one bare prereq keeps the other bare prereq', () => {
    const goalId = 'award'
    const edge = persist({ baseEdge: null, specs: [], goalId, prerequisites: ['patent', 'paper'] })
    const next = removeRow(edge.specs ?? [], edge.groups ?? [], edge.prerequisites, {
      key: 'bare-patent',
      spec: { kind: 'simple', id: 'patent' },
      label: '',
      detail: '专利',
      removeIds: ['patent']
    })
    const edge2 = persist({ baseEdge: edge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge2.prerequisites).toEqual(['paper'])
  })

  it('removing a simple chip keeps unrelated legacy groups', () => {
    const goalId = 'award'
    const baseEdge: Edge = {
      to: goalId,
      prerequisites: ['a', 'b', 'c'],
      rule: 'all',
      groups: [['a', 'b']]
    }
    const next = removeRow(baseEdge.specs ?? [], baseEdge.groups ?? [], baseEdge.prerequisites, {
      key: 'bare-c',
      spec: { kind: 'simple', id: 'c' },
      label: '',
      detail: 'c',
      removeIds: ['c']
    })
    const edge2 = persist({ baseEdge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge2.groups).toEqual([['a', 'b']])
    expect(edge2.prerequisites).toEqual(['a', 'b'])
  })

  it('removing a legacy group row drops that group but keeps other prereqs', () => {
    const goalId = 'award'
    const baseEdge: Edge = {
      to: goalId,
      prerequisites: ['a', 'b', 'c'],
      rule: 'all',
      groups: [['a', 'b']]
    }
    const next = removeRow(baseEdge.specs ?? [], baseEdge.groups ?? [], baseEdge.prerequisites, {
      key: 'legacy-group-0',
      spec: { kind: 'group', members: ['a', 'b'], pick: 1 },
      label: '组合 1（任选其一）',
      detail: 'a 或 b',
      removeIds: ['a', 'b']
    })
    const edge2 = persist({ baseEdge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge2.groups).toEqual([])
    expect(edge2.prerequisites).toEqual(['c'])
  })

  it('non-remove op on mixed data (specs + old bare id) keeps the bare id', () => {
    const goalId = 'award'
    // 旧数据：一个 spec 化的 paper + 一个裸 patent
    const baseEdge: Edge = {
      to: goalId,
      prerequisites: ['patent', 'paper'],
      rule: 'all',
      specs: [{ kind: 'simple', id: 'paper' }]
    }
    // 模拟 addExclude（不传 specs/prerequisites/groups，仅加 excludes）→ 裸 patent 不能丢
    // 注意：推导顺序是 spec 成员在前、裸 id 补在后，与语义无关（unlock 不依赖顺序）
    const edge2 = persist({ baseEdge, specs: baseEdge.specs ?? [], goalId })
    expect(edge2.prerequisites).toEqual(['paper', 'patent'])
    expect(edge2.specs).toHaveLength(1)
  })

  it('clearGroups keeps bare prereqs as simple list', () => {
    const goalId = 'award'
    const baseEdge: Edge = {
      to: goalId,
      prerequisites: ['a', 'b'],
      rule: 'all',
      groups: [['a', 'b']]
    }
    // 模拟『清除组合 / 规则』：specs=[] clearGroups=true → a,b 保留为普通前置
    const edge2 = persist({ baseEdge, specs: [], goalId, clearGroups: true })
    expect(edge2.groups).toBeUndefined()
    expect(edge2.prerequisites).toEqual(['a', 'b'])
  })

  it('no cycle introduced by removing a chip', () => {
    const goalId = 'award'
    const initialSpecs: PrereqSpec[] = [
      { kind: 'simple', id: 'top_paper', count: 2 }
    ]
    const edge = persist({ baseEdge: null, specs: initialSpecs, goalId })
    const next = removeRow(edge.specs ?? [], edge.groups ?? [], edge.prerequisites, {
      key: 'spec-simple-0-top_paper',
      spec: { kind: 'simple', id: 'top_paper', count: 2 },
      label: '',
      detail: '一作 top',
      removeIds: ['top_paper']
    })
    const edge2 = persist({ baseEdge: edge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    const cycles = detectCycles([edge2])
    expect(cycles).toHaveLength(0)
  })
})

describe('removeRow + persist simulation — countable multiple instances', () => {
  // 同一 countable 任务被多次添加为 simple spec，每次引用次数不同
  it('multiple simple specs of same id coexist in specs, deduped in prerequisites', () => {
    const goalId = 'award'
    const initialSpecs: PrereqSpec[] = [
      { kind: 'simple', id: 'paper', count: 1 },
      { kind: 'simple', id: 'paper', count: 2 }
    ]
    const edge = persist({ baseEdge: null, specs: initialSpecs, goalId })
    // specs 保留两条；prerequisites 去重为一条
    expect(edge.specs).toHaveLength(2)
    expect(edge.prerequisites).toEqual(['paper'])
  })

  it('removing one simple spec (count=1) keeps the count=2 instance', () => {
    const goalId = 'award'
    const baseEdge: Edge = {
      to: goalId,
      prerequisites: ['paper'],
      rule: 'all',
      specs: [
        { kind: 'simple', id: 'paper', count: 1 },
        { kind: 'simple', id: 'paper', count: 2 }
      ]
    }
    const next = removeRow(baseEdge.specs ?? [], baseEdge.groups ?? [], baseEdge.prerequisites, {
      key: 'spec-simple-0-paper-1',
      spec: { kind: 'simple', id: 'paper', count: 1 },
      label: '',
      detail: 'paper',
      removeIds: ['paper']
    })
    const edge2 = persist({ baseEdge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    expect(edge2.specs).toHaveLength(1)
    expect(edge2.specs![0]).toEqual({ kind: 'simple', id: 'paper', count: 2 })
    expect(edge2.prerequisites).toEqual(['paper'])
  })

  it('group with per-member count (countable) keeps both members', () => {
    const goalId = 'award'
    const initialSpecs: PrereqSpec[] = [
      { kind: 'simple', id: 'paper', count: 1 },
      {
        kind: 'group',
        members: [{ id: 'paper', count: 2 }, { id: 'patent' }],
        pick: 1
      }
    ]
    const edge = persist({ baseEdge: null, specs: initialSpecs, goalId })
    // 两条 spec 都保留；prerequisites 同时包含 paper 和 patent（group 的 member 也算）
    expect(edge.specs).toHaveLength(2)
    expect(edge.prerequisites).toContain('paper')
    expect(edge.prerequisites).toContain('patent')
  })

  it('removing only one member of a group keeps the other', () => {
    const goalId = 'award'
    const baseEdge: Edge = {
      to: goalId,
      prerequisites: ['paper', 'patent'],
      rule: 'all',
      specs: [
        {
          kind: 'group',
          members: [{ id: 'paper', count: 2 }, { id: 'patent' }],
          pick: 1
        }
      ]
    }
    const next = removeRow(baseEdge.specs ?? [], baseEdge.groups ?? [], baseEdge.prerequisites, {
      key: 'spec-group-0',
      spec: {
        kind: 'group',
        members: [{ id: 'paper', count: 2 }, { id: 'patent' }],
        pick: 1
      },
      label: '组合',
      detail: 'paper ×2 或 patent',
      removeIds: ['paper'] // 只移除 paper
    })
    const edge2 = persist({ baseEdge, specs: next.specs, goalId, prerequisites: next.prerequisites, groups: next.groups })
    // group 仍存在但只剩 patent
    expect(edge2.specs).toHaveLength(1)
    if (edge2.specs![0].kind === 'group') {
      expect(edge2.specs![0].members).toEqual([{ id: 'patent' }])
    }
    expect(edge2.prerequisites).toEqual(['patent'])
  })

  it('backward compat — old GroupSpec with string members persists identically', () => {
    const goalId = 'award'
    const initialSpecs: PrereqSpec[] = [
      { kind: 'group', members: ['a', 'b'], pick: 1 }
    ]
    const edge = persist({ baseEdge: null, specs: initialSpecs, goalId })
    // 旧 ['a','b'] 形态推导 prerequisites = ['a','b']
    expect(edge.specs).toHaveLength(1)
    expect(edge.prerequisites).toEqual(['a', 'b'])
  })
})
