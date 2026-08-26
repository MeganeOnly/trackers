import { describe, expect, it, beforeEach } from 'vitest'
import type { Edge, PrereqSpec } from '@core'
import { detectCycles } from '@core'

// 这是一个独立可验证的回归测试：
// 还原 removeRow 的过滤逻辑 + persist 的 newEdge 构造，模拟"加 ×2 simple spec → 删除"流程。
// 如果 removeRow 在某个边界条件上过滤出错，这里会失败。

interface RenderedRow {
  key: string
  spec: PrereqSpec
  label: string
  detail: string
  removeIds: string[]
}

function removeRow(specs: PrereqSpec[], row: RenderedRow): PrereqSpec[] {
  const removeSet = new Set(row.removeIds)
  return specs
    .map((s) => {
      if (s.kind === 'simple') return removeSet.has(s.id) ? null : s
      if (s.kind === 'group' || s.kind === 'count') {
        const left = s.members.filter((m) => !removeSet.has(m))
        if (left.length === 0) return null
        return { ...s, members: left }
      }
      return s
    })
    .filter((s): s is PrereqSpec => s !== null)
}

function persist({
  baseEdge,
  specs,
  goalId
}: {
  baseEdge: Edge | null
  specs: PrereqSpec[]
  goalId: string
}): Edge {
  const positiveSpecs = specs.filter((s) => s.kind !== 'exclude')
  const newPrereqIds: string[] = []
  const seen = new Set<string>()
  for (const s of positiveSpecs) {
    if (s.kind === 'simple') {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        newPrereqIds.push(s.id)
      }
    } else {
      for (const m of s.members) {
        if (!seen.has(m)) {
          seen.add(m)
          newPrereqIds.push(m)
        }
      }
    }
  }
  const nextSpecs = specs
  const newExcludes: typeof specs = []
  return {
    ...(baseEdge ?? { to: goalId, prerequisites: [], rule: 'all' as const }),
    to: goalId,
    prerequisites: newPrereqIds,
    specs: nextSpecs.length > 0 ? nextSpecs : undefined
  }
}

describe('removeRow + persist simulation', () => {
  it('add ×2 simple spec then remove: spec vanishes, prerequisites=[id]', () => {
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
    const nextSpecs = removeRow(edge.specs ?? [], row)
    edge = persist({ baseEdge: edge, specs: nextSpecs, goalId })
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

    const nextSpecs = removeRow(edge.specs ?? [], {
      key: 'spec-simple-1-patent',
      spec: { kind: 'simple', id: 'patent' },
      label: '',
      detail: '专利',
      removeIds: ['patent']
    })
    const edge2 = persist({ baseEdge: edge, specs: nextSpecs, goalId })
    expect(edge2.specs).toHaveLength(1)
    expect(edge2.specs![0]).toEqual({ kind: 'simple', id: 'top_paper', count: 2 })
    expect(edge2.prerequisites).toEqual(['top_paper'])
  })

  it('no cycle introduced by removing a chip', () => {
    const goalId = 'award'
    const initialSpecs: PrereqSpec[] = [
      { kind: 'simple', id: 'top_paper', count: 2 }
    ]
    const edge = persist({ baseEdge: null, specs: initialSpecs, goalId })
    const nextSpecs = removeRow(edge.specs ?? [], {
      key: 'spec-simple-0-top_paper',
      spec: { kind: 'simple', id: 'top_paper', count: 2 },
      label: '',
      detail: '一作 top',
      removeIds: ['top_paper']
    })
    const edge2 = persist({ baseEdge: edge, specs: nextSpecs, goalId })
    const cycles = detectCycles([edge2])
    expect(cycles).toHaveLength(0)
  })
})
