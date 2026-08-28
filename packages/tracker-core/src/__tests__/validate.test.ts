import { describe, expect, it } from 'vitest'
import { computeUnlocked } from '../unlock'
import { CODE_DUPLICATE_TO, formatIssues, validateEdges } from '../validate'
import type { Edge } from '../types'

function edge(to: string, prereqs: string[]): Edge {
  return { to, prerequisites: prereqs, rule: 'all' }
}

describe('validateEdges', () => {
  it('空 edges 无问题', () => {
    expect(validateEdges([])).toEqual([])
  })

  it('to 唯一时无问题', () => {
    const edges = [edge('a', ['x']), edge('b', ['y']), edge('c', ['z'])]
    expect(validateEdges(edges)).toEqual([])
  })

  it('重复 to 只报一条 issue 并带上边数', () => {
    const edges = [edge('a', ['x']), edge('a', ['y']), edge('b', ['z'])]
    const issues = validateEdges(edges)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe(CODE_DUPLICATE_TO)
    expect(issues[0].to).toBe('a')
    // 文案要带上"2 条边"，便于用户判断严重性
    expect(issues[0].message).toContain('2')
  })

  it('多处重复按首次出现顺序输出', () => {
    // b 先出现重复，a 后出现重复 —— 输出必须 b 在 a 前（与 Rust 端一致）
    const edges = [edge('b', ['1']), edge('a', ['2']), edge('b', ['3']), edge('a', ['4'])]
    const issues = validateEdges(edges)
    expect(issues).toHaveLength(2)
    expect(issues[0].to).toBe('b')
    expect(issues[1].to).toBe('a')
  })

  it('三条同 to 报「2 条被丢弃」', () => {
    const edges = [edge('a', ['x']), edge('a', ['y']), edge('a', ['z'])]
    const issues = validateEdges(edges)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('3')
  })
})

describe('formatIssues', () => {
  it('无问题返回 null', () => {
    expect(formatIssues([])).toBeNull()
  })

  it('超过 3 条时折叠剩余计数', () => {
    const edges = ['a', 'b', 'c', 'd'].flatMap((t) => [edge(t, ['x']), edge(t, ['y'])])
    const issues = validateEdges(edges)
    expect(issues).toHaveLength(4)
    const msg = formatIssues(issues)
    expect(msg).toContain('4 处')
    expect(msg).toContain('另有 1 处未列出')
  })
})

describe('duplicate_to 与 computeUnlocked 的实际行为绑定', () => {
  // 回归锚点：把校验函数与它要防的行为钉在一起。
  // 若哪天 computeUnlocked 改成合并同 to 的多条边，本测试会失败，
  // 提示同步放宽 / 删除 duplicate_to 检查。
  it('重复 to 确实会让前置条件被静默丢弃', () => {
    // 两条同 to 的边：第一条要 x，第二条要 y。只有 x 完成。
    const edges = [edge('t', ['x']), edge('t', ['y'])]
    const isDone = (id: string) => id === 'x'
    const r = computeUnlocked(['x', 'y', 't'], edges, isDone)
    // 后一条边（要 y）覆盖前一条（要 x）→ y 未完成 → t 锁住。
    // 第一条边"要 x 且 x 已完成"这个事实被完全丢弃。
    expect(r.unlocked.get('t')).toBe(false)
    expect(validateEdges(edges)).toHaveLength(1)
  })
})
