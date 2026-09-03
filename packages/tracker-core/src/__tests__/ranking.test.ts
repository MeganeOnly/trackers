import { describe, expect, it } from 'vitest'
import {
  applyPairwiseResult,
  countComparisons,
  defaultRankingFile,
  expectedScore,
  pickNextPair,
  recomputeRatings
} from '../ranking'

const INITIAL = 1500
const K = 32

describe('expectedScore', () => {
  it('equal ratings → 0.5', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 5)
  })

  it('higher rated player has > 0.5 expected score', () => {
    const score = expectedScore(1700, 1500)
    expect(score).toBeGreaterThan(0.5)
    expect(score).toBeLessThan(1)
  })

  it('rating diff of 400 → ~0.909', () => {
    // Elo 标准：差 400 分 → 强方胜率约 90.9%
    expect(expectedScore(1900, 1500)).toBeCloseTo(0.909, 3)
  })
})

describe('defaultRankingFile', () => {
  it('has correct defaults', () => {
    const f = defaultRankingFile()
    expect(f.version).toBe(1)
    expect(f.initialRating).toBe(1500)
    expect(f.kFactor).toBe(32)
    expect(f.history).toEqual([])
  })
})

describe('applyPairwiseResult', () => {
  it('a wins → a gains, b loses, ratings sum to 2*initial (K cancels)', () => {
    const r0: Record<string, number> = {}
    const r1 = applyPairwiseResult(r0, { a: '1', b: '2', winner: 'a' }, INITIAL, K)
    expect(r1['1']).toBeGreaterThan(INITIAL)
    expect(r1['2']).toBeLessThan(INITIAL)
    // Elo 不变量：双方分数变化绝对值相等、方向相反
    expect(r1['1'] + r1['2']).toBeCloseTo(2 * INITIAL, 5)
  })

  it('tie → both move toward each other', () => {
    const r0: Record<string, number> = { '1': 1700, '2': 1500 }
    const r1 = applyPairwiseResult(r0, { a: '1', b: '2', winner: 'tie' }, INITIAL, K)
    // 强方小幅下降、弱方小幅上升
    expect(r1['1']).toBeLessThan(1700)
    expect(r1['2']).toBeGreaterThan(1500)
    expect(r1['1'] + r1['2']).toBeCloseTo(1700 + 1500, 5)
  })

  it('uses initial rating for unseen ids', () => {
    const r = applyPairwiseResult({}, { a: 'x', b: 'y', winner: 'a' }, INITIAL, K)
    expect(r['x']).toBeGreaterThan(INITIAL)
    expect(r['y']).toBeLessThan(INITIAL)
  })
})

describe('recomputeRatings', () => {
  it('empty history + empty pool → empty ratings', () => {
    expect(recomputeRatings([], [], INITIAL, K)).toEqual({})
  })

  it('empty history → every pool id is at initial rating', () => {
    const ratings = recomputeRatings([], ['1', '2', '3'], INITIAL, K)
    expect(ratings).toEqual({ '1': INITIAL, '2': INITIAL, '3': INITIAL })
  })

  it('history with deleted ids is filtered out', () => {
    // 4 个条目里有 2 个引用了已删除的 id → 应被跳过
    const history = [
      { a: '1', b: '2', winner: 'a' as const, ts: '2025-01-01T00:00:00Z' },
      { a: '1', b: '99', winner: 'a' as const, ts: '2025-01-02T00:00:00Z' }, // 99 不在 pool
      { a: '2', b: '3', winner: 'b' as const, ts: '2025-01-03T00:00:00Z' },
      { a: '77', b: '3', winner: 'a' as const, ts: '2025-01-04T00:00:00Z' } // 77 不在 pool
    ]
    const ratings = recomputeRatings(history, ['1', '2', '3'], INITIAL, K)
    // 只剩 2 条有效：(1 vs 2, a 赢) + (2 vs 3, b 赢)
    // 1 赢 2 → 1 涨
    // 2 输给 3 → 2 跌、3 涨
    expect(ratings['1']).toBeGreaterThan(INITIAL)
    expect(ratings['2']).toBeLessThan(INITIAL)
    expect(ratings['3']).toBeGreaterThan(INITIAL)
    // 不应包含被删的 id
    expect(ratings['99']).toBeUndefined()
    expect(ratings['77']).toBeUndefined()
  })

  it('is deterministic: same history + pool → same ratings', () => {
    const history = [
      { a: '1', b: '2', winner: 'a' as const, ts: '2025-01-01T00:00:00Z' },
      { a: '2', b: '3', winner: 'b' as const, ts: '2025-01-02T00:00:00Z' }
    ]
    const r1 = recomputeRatings(history, ['1', '2', '3'], INITIAL, K)
    const r2 = recomputeRatings(history, ['1', '2', '3'], INITIAL, K)
    expect(r1).toEqual(r2)
  })

  it('final order reflects transitive wins', () => {
    // 1 总是赢 2，2 总是赢 3，1 总是赢 3 → 期望 1 > 2 > 3
    const history = [
      { a: '1', b: '2', winner: 'a' as const, ts: 't1' },
      { a: '1', b: '2', winner: 'a' as const, ts: 't2' },
      { a: '1', b: '2', winner: 'a' as const, ts: 't3' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't4' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't5' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't6' }
    ]
    const ratings = recomputeRatings(history, ['1', '2', '3'], INITIAL, K)
    expect(ratings['1']).toBeGreaterThan(ratings['2'])
    expect(ratings['2']).toBeGreaterThan(ratings['3'])
  })
})

describe('countComparisons', () => {
  it('counts entries where id is a or b', () => {
    const history = [
      { a: '1', b: '2', winner: 'a' as const, ts: 't1' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't2' },
      { a: '1', b: '3', winner: 'a' as const, ts: 't3' }
    ]
    const counts = countComparisons(history, ['1', '2', '3'])
    expect(counts).toEqual({ '1': 2, '2': 2, '3': 2 })
  })

  it('skips entries with ids outside pool', () => {
    const history = [
      { a: '1', b: '99', winner: 'a' as const, ts: 't1' }
    ]
    const counts = countComparisons(history, ['1', '2'])
    expect(counts['1']).toBe(0) // 99 不在 pool，整条不算
    expect(counts['2']).toBe(0)
  })
})

describe('pickNextPair', () => {
  it('returns null when pool < 2', () => {
    expect(pickNextPair([], [], {}, INITIAL)).toBeNull()
    expect(pickNextPair(['only'], [], { only: INITIAL }, INITIAL)).toBeNull()
  })

  it('first comparison: A is least-compared (everyone tied at 0)', () => {
    const rng = () => 0 // 永远选第一个候选
    const [a, b] = pickNextPair(['1', '2', '3'], [], {}, INITIAL, rng)!
    expect(a).toBe('1')
    // B = 评分最接近 1 的（都是 INITIAL → 第一个非 A）
    expect(b).toBe('2')
  })

  it('prefers least-compared book as A', () => {
    // 1 已经被比了 2 次，2 和 3 各 0 次 → A 应是 2 或 3
    const history = [
      { a: '1', b: '2', winner: 'a' as const, ts: 't1' },
      { a: '1', b: '2', winner: 'a' as const, ts: 't2' }
    ]
    const ratings = recomputeRatings(history, ['1', '2', '3'], INITIAL, K)
    const rng = () => 0
    const [a] = pickNextPair(['1', '2', '3'], history, ratings, INITIAL, rng)!
    expect(a).not.toBe('1')
    expect(['2', '3']).toContain(a)
  })

  it('B is the closest-rated book to A (excluding A)', () => {
    // 构造一个 rating 序列让预期明确：
    // ratings = { 1: 1500, 2: 1700, 3: 1505 }
    // 强制 A = 1（最少比较），则 B 应该是 3（差 5）而不是 2（差 200）
    const ratings: Record<string, number> = { '1': 1500, '2': 1700, '3': 1505 }
    // history 让 1 跟 2、3 各比过几次，让 1 的 count 最少
    const history = [
      { a: '2', b: '3', winner: 'a' as const, ts: 't1' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't2' },
      { a: '2', b: '3', winner: 'b' as const, ts: 't3' }
    ]
    const counts = countComparisons(history, ['1', '2', '3'])
    expect(counts['1']).toBe(0) // A 锁定为 1
    expect(counts['2']).toBe(3)
    expect(counts['3']).toBe(3)
    const [a, b] = pickNextPair(['1', '2', '3'], history, ratings, INITIAL, () => 0)!
    expect(a).toBe('1')
    expect(b).toBe('3') // 比 2 更接近
  })

  it('exclude: filters out excluded ids from A candidates', () => {
    // 历史让 1 的 count 最少,但 exclude 把 1 排除 → A 必须从 2/3 选
    const history = [
      { a: '2', b: '3', winner: 'a' as const, ts: 't1' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't2' }
    ]
    const ratings = recomputeRatings(history, ['1', '2', '3'], INITIAL, K)
    const [a] = pickNextPair(
      ['1', '2', '3'],
      history,
      ratings,
      INITIAL,
      () => 0,
      new Set(['1'])
    )!
    expect(a).not.toBe('1')
    expect(['2', '3']).toContain(a)
  })

  it('exclude: filters out excluded ids from B candidates', () => {
    // 强制 A = '1'(最少比较),排除 '3' → B 只能是 '2'
    const ratings: Record<string, number> = { '1': 1500, '2': 1700, '3': 1505 }
    const history = [
      { a: '2', b: '3', winner: 'a' as const, ts: 't1' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't2' },
      { a: '2', b: '3', winner: 'b' as const, ts: 't3' }
    ]
    const [, b] = pickNextPair(
      ['1', '2', '3'],
      history,
      ratings,
      INITIAL,
      () => 0,
      new Set(['3']) // 排掉 3,B 只能选 2
    )!
    expect(b).toBe('2')
  })

  it('exclude: returns null when filtered pool drops below 2', () => {
    // pool = 4 个,exclude = 3 个 → 剩 1 个,无对可挑
    expect(
      pickNextPair(['1', '2', '3', '4'], [], {}, INITIAL, () => 0, new Set(['1', '2', '3']))
    ).toBeNull()
    // pool = 3 个,exclude = 2 个 → 剩 1 个,无对可挑(避免重复展示同一本)
    expect(
      pickNextPair(['1', '2', '3'], [], {}, INITIAL, () => 0, new Set(['1', '2']))
    ).toBeNull()
  })

  it('exclude: empty set behaves identically to the 5-arg signature (back-compat)', () => {
    const ratings: Record<string, number> = { '1': 1500, '2': 1700, '3': 1505 }
    const history = [
      { a: '2', b: '3', winner: 'a' as const, ts: 't1' },
      { a: '2', b: '3', winner: 'a' as const, ts: 't2' }
    ]
    const without = pickNextPair(['1', '2', '3'], history, ratings, INITIAL, () => 0)!
    const withEmpty = pickNextPair(
      ['1', '2', '3'],
      history,
      ratings,
      INITIAL,
      () => 0,
      new Set()
    )!
    expect(withEmpty).toEqual(without)
  })

  it('exclude: stays within filter even when pool order changes', () => {
    // 池子顺序与 exclude 顺序无关,过滤只看成员身份
    const ratings: Record<string, number> = { '1': 1500, '2': 1501, '3': 1499 }
    const [a, b] = pickNextPair(
      ['1', '2', '3'],
      [],
      ratings,
      INITIAL,
      () => 0,
      new Set(['2'])
    )!
    expect(['1', '3']).toContain(a)
    expect(['1', '3']).toContain(b)
    expect(a).not.toBe(b)
    expect(a).not.toBe('2')
    expect(b).not.toBe('2')
  })
})
