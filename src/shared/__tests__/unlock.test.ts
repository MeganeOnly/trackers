import { describe, expect, it } from 'vitest'
import { computeUnlocked, detectCycles } from '../unlock'
import type { Book, Edge } from '../types'

function mkBook(id: string, status: Book['status'] = 'want'): Book {
  return {
    id,
    title: id,
    author: 'a',
    country: 'c',
    year: 2000,
    translator: '',
    status,
    read_count: 1,
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-01T00:00:00.000Z',
    tags: []
  }
}

describe('computeUnlocked', () => {
  it('无前置的书永远解锁', () => {
    const books = [mkBook('a')]
    const r = computeUnlocked(books, [])
    expect(r.unlocked.get('a')).toBe(true)
  })

  it('rule=all: 所有前置 finished 才解锁', () => {
    const books = [mkBook('a', 'finished'), mkBook('b', 'want'), mkBook('c', 'want')]
    const edges: Edge[] = [{ to: 'c', prerequisites: ['a', 'b'], rule: 'all' }]
    const r = computeUnlocked(books, edges)
    expect(r.unlocked.get('a')).toBe(true)
    expect(r.unlocked.get('b')).toBe(true)
    expect(r.unlocked.get('c')).toBe(false)

    books[1].status = 'finished' // b 也读完了
    const r2 = computeUnlocked(books, edges)
    expect(r2.unlocked.get('c')).toBe(true)
  })

  it('rule=any_of: 至少 threshold 个 finished', () => {
    const books = [
      mkBook('a', 'finished'),
      mkBook('b', 'finished'),
      mkBook('c', 'want'),
      mkBook('target', 'want')
    ]
    const edges: Edge[] = [
      { to: 'target', prerequisites: ['a', 'b', 'c'], rule: 'any_of', threshold: 2 }
    ]
    const r = computeUnlocked(books, edges)
    expect(r.unlocked.get('target')).toBe(true)

    books[1].status = 'want' // 只剩 a finished
    const r2 = computeUnlocked(books, edges)
    expect(r2.unlocked.get('target')).toBe(false)
  })

  it('abandoned/shelved/reading 都不算 finished', () => {
    const books = [
      mkBook('a', 'abandoned'),
      mkBook('b', 'shelved'),
      mkBook('c', 'reading'),
      mkBook('target', 'want')
    ]
    const edges: Edge[] = [{ to: 'target', prerequisites: ['a', 'b', 'c'], rule: 'all' }]
    const r = computeUnlocked(books, edges)
    expect(r.unlocked.get('target')).toBe(false)
  })

  it('循环依赖：环上的书标 false 并报告环', () => {
    const books = [mkBook('a'), mkBook('b')]
    const edges: Edge[] = [
      { to: 'a', prerequisites: ['b'], rule: 'all' },
      { to: 'b', prerequisites: ['a'], rule: 'all' }
    ]
    const r = computeUnlocked(books, edges)
    expect(r.unlocked.get('a')).toBe(false)
    expect(r.unlocked.get('b')).toBe(false)
    expect(r.cycles.length).toBeGreaterThan(0)
  })

  it('悬空引用被静默忽略', () => {
    const books = [mkBook('a', 'finished'), mkBook('target', 'want')]
    const edges: Edge[] = [
      { to: 'target', prerequisites: ['a', 'ghost'], rule: 'all' }
    ]
    const r = computeUnlocked(books, edges)
    expect(r.unlocked.get('target')).toBe(true)
  })
})

describe('detectCycles', () => {
  it('无环返回空', () => {
    const edges: Edge[] = [{ to: 'b', prerequisites: ['a'], rule: 'all' }]
    expect(detectCycles(edges)).toEqual([])
  })

  it('自环 (a→a) 被检测', () => {
    const edges: Edge[] = [{ to: 'a', prerequisites: ['a'], rule: 'all' }]
    const cycles = detectCycles(edges)
    expect(cycles.length).toBeGreaterThan(0)
  })
})
