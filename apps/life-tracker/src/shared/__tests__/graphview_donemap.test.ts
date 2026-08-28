// 回归测试：GraphView 的解锁计算必须应用 done 谓词改写层
//（互斥规则 exclude + countable 引用次数）。
//
// 2026-08 修复：原 GraphView 直接调 `isGoalDone(g)`，
//   - 不应用 ExcludeSpec → trigger 达成但 target 被 disqualifies 时，图里 target 仍显示可解锁；
//   - 不识别 countable 任务的 requiredCount → simple/group spec 引用 countable 任务时，
//     任务在图里永远灰（旧实现只按 status==done 判断）。
// 改用 `buildDonePredicate(goals, edges).isDone` 后与 PrereqEditor / CleanMode 语义一致。

import { describe, expect, it } from 'vitest'
import { computeUnlocked } from '@core'
import { buildDonePredicate } from '@shared/done'
import { isGoalDone } from '@shared/types'
import type { Edge, Goal } from '@shared/types'

/** 把 buildDonePredicate 应用到 goals+edges，模拟 GraphView 的核心计算路径 */
function graphUnlocked(goals: Goal[], edges: Edge[]): Map<string, boolean> {
  const { isDone } = buildDonePredicate(goals, edges)
  return computeUnlocked(goals.map((g) => g.id), edges, isDone).unlocked
}

function goal(over: Partial<Goal> & { id: string }): Goal {
  return {
    id: over.id,
    title: over.id,
    note: '',
    category: 'c',
    deadline: null,
    status: over.status ?? 'not_started',
    progress: over.progress ?? null,
    countable: over.countable ?? false,
    pinned: false,
    hidden: false,
    collapsed: false,
    created: '2024-01-01',
    updated: '2024-01-01'
  }
}

describe('GraphView done 谓词改写层', () => {
  it('旧实现（裸 isGoalDone）：countable 任务在图里永远未解锁', () => {
    // 旧 bug 留档：说明为什么必须改
    const B = goal({ id: 'B', status: 'in_progress', progress: { current: 5, total: null }, countable: true })
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [{ to: 'T', prerequisites: ['B'], rule: 'all' }]

    const raw = computeUnlocked(
      ['B', 'T'],
      edges,
      (id) => {
        const g = [B, T].find((x) => x.id === id)
        return g ? isGoalDone(g) : false
      }
    ).unlocked
    expect(raw.get('T')).toBe(false) // 旧实现：B 永远不算 done → T 不解锁
  })

  it('修复后：countable B 完成 5 次应让 T 解锁', () => {
    const B = goal({ id: 'B', status: 'in_progress', progress: { current: 5, total: null }, countable: true })
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [{ to: 'T', prerequisites: ['B'], rule: 'all' }]
    expect(graphUnlocked([B, T], edges).get('T')).toBe(true)
  })

  it('修复后：countable B 完成 1 次（requiredCount=1）即让 T 解锁', () => {
    const B = goal({ id: 'B', status: 'in_progress', progress: { current: 1, total: null }, countable: true })
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [{ to: 'T', prerequisites: ['B'], rule: 'all' }]
    expect(graphUnlocked([B, T], edges).get('T')).toBe(true)
  })

  it('修复后：countable B 完成 0 次 → T 不解锁', () => {
    const B = goal({ id: 'B', status: 'in_progress', progress: { current: 0, total: null }, countable: true })
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [{ to: 'T', prerequisites: ['B'], rule: 'all' }]
    expect(graphUnlocked([B, T], edges).get('T')).toBe(false)
  })

  it('修复后：exclude disqualifies 让 target 在图里显示未解锁', () => {
    const A = goal({ id: 'A', status: 'done' })
    const X = goal({ id: 'X', status: 'done' }) // trigger
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [
      {
        to: 'T',
        prerequisites: ['A'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'A' },
          { kind: 'exclude', trigger: 'X', target: 'A', effect: 'disqualifies' }
        ]
      }
    ]
    // X 已 done → A 被 disqualifies → T 不应解锁
    expect(graphUnlocked([A, X, T], edges).get('T')).toBe(false)
  })

  it('修复后：exclude satisfies 让 target 在图里显示已解锁', () => {
    const A = goal({ id: 'A', status: 'not_started' })
    const X = goal({ id: 'X', status: 'done' })
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [
      {
        to: 'T',
        prerequisites: ['A'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'A' },
          { kind: 'exclude', trigger: 'X', target: 'A', effect: 'satisfies' }
        ]
      }
    ]
    // X 已 done → A 被 satisfies → T 应解锁
    expect(graphUnlocked([A, X, T], edges).get('T')).toBe(true)
  })

  it('修复后：group per-member count 应用于图渲染', () => {
    // 用户原例：(B 完成 1 次) AND ((B 完成 2 次) OR C 完成)
    const B = goal({ id: 'B', progress: { current: 1, total: null }, countable: true })
    const C = goal({ id: 'C', status: 'not_started' })
    const T = goal({ id: 'T', status: 'not_started' })
    const edges: Edge[] = [
      {
        to: 'T',
        prerequisites: ['B'],
        rule: 'all',
        specs: [
          { kind: 'simple', id: 'B', count: 1 },
          { kind: 'group', members: [{ id: 'B', count: 2 }, { id: 'C' }], pick: 1 }
        ]
      }
    ]
    // B=1 且 C 未完成 → 不解锁（group 里 B=1 不满足，需 B=2 或 C done）
    expect(graphUnlocked([B, C, T], edges).get('T')).toBe(false)
  })
})
