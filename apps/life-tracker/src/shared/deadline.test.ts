import { describe, expect, it } from 'vitest'
import { URGENCY_WEIGHT, daysUntil, urgencyOf } from './deadline'

const NOW = new Date(2025, 5, 15) // 2025-06-15 本地

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    expect(daysUntil('2025-06-15', NOW)).toBe(0)
  })

  it('returns positive number for future date', () => {
    expect(daysUntil('2025-06-22', NOW)).toBe(7)
    expect(daysUntil('2025-07-15', NOW)).toBe(30)
  })

  it('returns negative number for past date', () => {
    expect(daysUntil('2025-06-14', NOW)).toBe(-1)
    expect(daysUntil('2024-12-31', NOW)).toBeLessThan(0)
  })

  it('crosses month boundary correctly', () => {
    expect(daysUntil('2025-07-01', NOW)).toBe(16)
  })

  it('crosses year boundary correctly', () => {
    const jan = new Date(2025, 0, 1) // 2025-01-01
    expect(daysUntil('2025-12-31', jan)).toBe(364)
    const dec = new Date(2025, 11, 30) // 2025-12-30
    expect(daysUntil('2026-01-05', dec)).toBe(6)
  })

  it('returns null for malformed string', () => {
    expect(daysUntil('2025/06/15', NOW)).toBeNull()
    expect(daysUntil('not a date', NOW)).toBeNull()
    expect(daysUntil('2025-6-15', NOW)).toBeNull() // 单月单日不合法
  })

  it('returns null for silently-overflowed date (2025-02-30)', () => {
    // JS 会把 2025-02-30 → 2025-03-02；要识别为非法
    expect(daysUntil('2025-02-30', NOW)).toBeNull()
    expect(daysUntil('2025-13-01', NOW)).toBeNull()
  })
})

describe('urgencyOf', () => {
  it('returns "none" for null / empty / malformed', () => {
    expect(urgencyOf(null, NOW)).toBe('none')
    expect(urgencyOf(undefined, NOW)).toBe('none')
    expect(urgencyOf('', NOW)).toBe('none')
    expect(urgencyOf('2025-02-30', NOW)).toBe('none')
  })

  it('returns "overdue" for past dates', () => {
    expect(urgencyOf('2025-06-14', NOW)).toBe('overdue')
    expect(urgencyOf('2025-01-01', NOW)).toBe('overdue')
  })

  it('returns "urgent" for 0..7 days (inclusive)', () => {
    expect(urgencyOf('2025-06-15', NOW)).toBe('urgent') // 今天
    expect(urgencyOf('2025-06-22', NOW)).toBe('urgent') // +7
  })

  it('returns "overdue" (not urgent) for past dates within 7 days', () => {
    expect(urgencyOf('2025-06-08', NOW)).toBe('overdue') // -7 走 overdue 分支
  })

  it('returns "soon" for 8..30 days', () => {
    expect(urgencyOf('2025-06-23', NOW)).toBe('soon') // +8
    expect(urgencyOf('2025-07-15', NOW)).toBe('soon') // +30
  })

  it('returns "none" for > 30 days', () => {
    expect(urgencyOf('2025-07-16', NOW)).toBe('none') // +31
    expect(urgencyOf('2026-06-15', NOW)).toBe('none') // +1y
  })

  it('matches daysUntil boundaries', () => {
    // 关键边界 7/8 和 30/31
    expect(urgencyOf('2025-06-22', NOW)).toBe('urgent') // +7 仍是 urgent
    expect(urgencyOf('2025-06-23', NOW)).toBe('soon') // +8 切到 soon
    expect(urgencyOf('2025-07-15', NOW)).toBe('soon') // +30 仍是 soon
    expect(urgencyOf('2025-07-16', NOW)).toBe('none') // +31 切到 none
  })
})

describe('URGENCY_WEIGHT', () => {
  it('sorts overdue > urgent > soon > none', () => {
    expect(URGENCY_WEIGHT.overdue).toBeGreaterThan(URGENCY_WEIGHT.urgent)
    expect(URGENCY_WEIGHT.urgent).toBeGreaterThan(URGENCY_WEIGHT.soon)
    expect(URGENCY_WEIGHT.soon).toBeGreaterThan(URGENCY_WEIGHT.none)
  })
})
