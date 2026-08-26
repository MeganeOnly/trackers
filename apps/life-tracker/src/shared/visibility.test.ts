import { describe, expect, it } from 'vitest'
import { computeDailyHidden } from './visibility'
import type { Edge, Goal } from './types'

function goal(id: string, status: Goal['status'] = 'not_started'): Goal {
  return {
    id,
    title: id,
    note: '',
    category: '',
    deadline: null,
    status,
    progress: null,
    countable: false,
    pinned: false,
    hidden: false,
    created: '',
    updated: ''
  }
}

function edge(to: string, ...prerequisites: string[]): Edge {
  return { to, prerequisites, rule: 'all' }
}

describe('computeDailyHidden', () => {
  it('无边时隐藏集合为空', () => {
    const goals = [goal('a', 'in_progress'), goal('b', 'not_started')]
    expect(computeDailyHidden(goals, []).size).toBe(0)
  })

  it('上级仍活跃（进行中）→ 不隐藏', () => {
    const goals = [goal('a', 'not_started'), goal('p', 'in_progress')]
    const edges = [edge('p', 'a')]
    expect(computeDailyHidden(goals, edges).has('a')).toBe(false)
  })

  it('上级被搁置 → 隐藏下游', () => {
    const goals = [goal('a', 'not_started'), goal('p', 'shelved')]
    const edges = [edge('p', 'a')]
    expect(computeDailyHidden(goals, edges).has('a')).toBe(true)
  })

  it('上级被放弃 → 隐藏下游', () => {
    const goals = [goal('a', 'in_progress'), goal('p', 'abandoned')]
    const edges = [edge('p', 'a')]
    expect(computeDailyHidden(goals, edges).has('a')).toBe(true)
  })

  it('多个上级一活一死 → 不隐藏', () => {
    const goals = [goal('a', 'not_started'), goal('p1', 'shelved'), goal('p2', 'in_progress')]
    const edges = [edge('p1', 'a'), edge('p2', 'a')]
    expect(computeDailyHidden(goals, edges).has('a')).toBe(false)
  })

  it('传递链全部终止于搁置 → 隐藏整条链', () => {
    const goals = [
      goal('g', 'not_started'),
      goal('p', 'in_progress'),
      goal('t', 'shelved')
    ]
    const edges = [edge('p', 'g'), edge('t', 'p')]
    const blocked = computeDailyHidden(goals, edges)
    expect(blocked.has('g')).toBe(true)
    expect(blocked.has('p')).toBe(true)
    expect(blocked.has('t')).toBe(false) // 搁置自身不进可推进列表，不参与
  })

  it('传递链到达活跃顶层 → 全部显示', () => {
    const goals = [
      goal('g', 'not_started'),
      goal('p', 'in_progress'),
      goal('t', 'in_progress')
    ]
    const edges = [edge('p', 'g'), edge('t', 'p')]
    expect(computeDailyHidden(goals, edges).size).toBe(0)
  })

  it('顶层无上级永不隐藏', () => {
    const goals = [goal('top', 'in_progress')]
    expect(computeDailyHidden(goals, []).has('top')).toBe(false)
  })

  it('纯环不隐藏（环防护保守策略）', () => {
    const goals = [goal('a', 'not_started'), goal('b', 'in_progress')]
    const edges = [edge('b', 'a'), edge('a', 'b')]
    expect(computeDailyHidden(goals, edges).size).toBe(0)
  })

  it('中断边（上级不存在）不误伤', () => {
    const goals = [goal('a', 'not_started'), goal('p', 'in_progress')]
    const edges = [edge('p', 'a'), edge('ghost', 'p')]
    expect(computeDailyHidden(goals, edges).has('a')).toBe(false)
  })
})
