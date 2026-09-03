// 集笔记 v1.3 时间戳笔记 —— stamp 工具函数的纯函数单测。
//
// 为什么留 book-tracker 内(不进 packages/tracker-core):
// - `EpisodeRecord.stamps` 是 Book 领域专属字段;stamp 工具函数绑定这个领域
// - tracker-core 只放"两 app 共用"的通用工具;stamp 不属于这一层
// - v1.2 `episodeKey` / `parseEpisodeKey` 也是同样放在 book-tracker 的 shared
//
// 覆盖三类行为:
// - `formatStamp` —— 秒 → 人类格式(hh:mm:ss 自动 vs mm:ss)
// - `parseStamp`  —— 人类格式 → 秒(三种格式 + 非法输入)
// - `sortStamps`  —— 按 start 升序稳定排序

import { describe, expect, it } from 'vitest'
import { formatStamp, parseStamp, sortStamps } from '@shared/types'
import type { TimeStamp } from '@shared/types'

describe('formatStamp', () => {
  it('小于一小时返回 mm:ss', () => {
    expect(formatStamp(0)).toBe('00:00')
    expect(formatStamp(45)).toBe('00:45')
    expect(formatStamp(60)).toBe('01:00')
    expect(formatStamp(1945)).toBe('32:25')
  })

  it('一小时及以上返回 hh:mm:ss', () => {
    expect(formatStamp(3600)).toBe('1:00:00')
    expect(formatStamp(3725)).toBe('1:02:05')
    expect(formatStamp(36000)).toBe('10:00:00')
  })

  it('负数 / 非整数 → 当 0 处理(防止显示 -1:00)', () => {
    expect(formatStamp(-10)).toBe('00:00')
    expect(formatStamp(45.7)).toBe('00:45')
  })
})

describe('parseStamp', () => {
  it('ss 格式', () => {
    expect(parseStamp('0')).toBe(0)
    expect(parseStamp('45')).toBe(45)
    expect(parseStamp('59')).toBe(59)
  })

  it('mm:ss 格式', () => {
    expect(parseStamp('0:30')).toBe(30)
    expect(parseStamp('12:34')).toBe(754)
    expect(parseStamp('59:59')).toBe(3599)
  })

  it('hh:mm:ss 格式', () => {
    expect(parseStamp('0:00:00')).toBe(0)
    expect(parseStamp('1:00:00')).toBe(3600)
    expect(parseStamp('1:02:03')).toBe(3723)
    expect(parseStamp('10:30:45')).toBe(37845)
  })

  it('trim 容忍前后空白', () => {
    expect(parseStamp('  12:34  ')).toBe(754)
    expect(parseStamp(' 0:30 ')).toBe(30)
  })

  it('非法输入返回 null', () => {
    expect(parseStamp('')).toBeNull()
    expect(parseStamp('   ')).toBeNull()
    expect(parseStamp('abc')).toBeNull()
    expect(parseStamp('1:2:3:4')).toBeNull() // 段数过多
    expect(parseStamp('-10')).toBeNull() // 负数
    expect(parseStamp('1.5')).toBeNull() // 浮点
    expect(parseStamp('1:60')).toBeNull() // 分位 ≥ 60
    expect(parseStamp('1:00:60')).toBeNull() // 秒位 ≥ 60
    expect(parseStamp('1:60:00')).toBeNull() // 分位 ≥ 60
  })
})

describe('sortStamps', () => {
  function s(id: string, start: number, end?: number, note = ''): TimeStamp {
    return { id, start, end, note }
  }

  it('按 start 升序排序', () => {
    const arr = [s('b', 500), s('a', 100), s('c', 300)]
    const sorted = sortStamps(arr)
    expect(sorted.map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('同 start 按 id 字典序(稳定排序)', () => {
    const arr = [s('z', 100), s('a', 100), s('m', 100)]
    const sorted = sortStamps(arr)
    expect(sorted.map((x) => x.id)).toEqual(['a', 'm', 'z'])
  })

  it('空数组 → 空数组', () => {
    expect(sortStamps([])).toEqual([])
  })

  it('单元素 → 单元素', () => {
    const arr = [s('only', 42)]
    const sorted = sortStamps(arr)
    expect(sorted.length).toBe(1)
    expect(sorted[0].id).toBe('only')
  })

  it('不修改原数组(纯函数)', () => {
    const arr = [s('b', 200), s('a', 100)]
    const snapshot = JSON.stringify(arr)
    sortStamps(arr)
    expect(JSON.stringify(arr)).toBe(snapshot)
  })
})