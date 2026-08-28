import { describe, expect, it } from 'vitest'
import { computeUnlocked } from '../unlock'
import { CODE_CYCLE, CODE_DUPLICATE_TO, formatIssues, validateEdges } from '../validate'
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

describe('validateEdges — cycle 检测', () => {
  it('无环不报告 cycle issue', () => {
    const edges = [edge('b', ['a']), edge('c', ['b'])]
    expect(validateEdges(edges).filter((i) => i.code === CODE_CYCLE)).toEqual([])
  })

  it('两节点自环被报告', () => {
    const edges = [edge('a', ['b']), edge('b', ['a'])]
    const issues = validateEdges(edges).filter((i) => i.code === CODE_CYCLE)
    expect(issues).toHaveLength(1)
    // detectCycles DFS 起点依赖 adj 迭代序，环路径既可能是 [a,b,a] 也可能是 [b,a,b]；
    // 这里只校验『环包含两节点、首尾相同』
    expect(issues[0].cycle?.length).toBe(3)
    expect(issues[0].cycle?.[0]).toBe(issues[0].cycle?.[2])
    expect(new Set(issues[0].cycle?.slice(0, 2)).size).toBe(2)
    expect(issues[0].message).toContain('循环依赖')
    // to 字段 = 环首节点（任意一种合法起点），不强制是 a
    expect(issues[0].to).toBe(issues[0].cycle?.[0])
  })

  it('自环 (a→a) 被报告', () => {
    const edges = [edge('a', ['a'])]
    const issues = validateEdges(edges).filter((i) => i.code === CODE_CYCLE)
    expect(issues).toHaveLength(1)
    expect(issues[0].cycle?.[0]).toBe('a')
    expect(issues[0].cycle?.[issues[0].cycle!.length - 1]).toBe('a')
  })

  it('长链环 a→b→c→a 被报告', () => {
    const edges = [edge('b', ['a']), edge('c', ['b']), edge('a', ['c'])]
    const issues = validateEdges(edges).filter((i) => i.code === CODE_CYCLE)
    expect(issues).toHaveLength(1)
    expect(issues[0].cycle).toHaveLength(4)
    expect(issues[0].cycle?.[0]).toBe(issues[0].cycle?.[issues[0].cycle!.length - 1])
  })

  it('duplicate_to 与 cycle 一起返回时,duplicate 在前 cycle 在后', () => {
    // t 重复 to 形成 2 条边；同时 b/a 构成环
    const edges = [
      edge('t', ['x']),
      edge('t', ['y']),
      edge('a', ['b']),
      edge('b', ['a'])
    ]
    const issues = validateEdges(edges)
    const codes = issues.map((i) => i.code)
    const dupIdx = codes.indexOf(CODE_DUPLICATE_TO)
    const cycIdx = codes.indexOf(CODE_CYCLE)
    expect(dupIdx).toBeGreaterThanOrEqual(0)
    expect(cycIdx).toBeGreaterThanOrEqual(0)
    expect(dupIdx).toBeLessThan(cycIdx)
  })

  it('formatIssues 在有 cycle 时仍正常工作', () => {
    const edges = [edge('a', ['b']), edge('b', ['a'])]
    const msg = formatIssues(validateEdges(edges))
    expect(msg).not.toBeNull()
    expect(msg).toContain('循环依赖')
  })
})
