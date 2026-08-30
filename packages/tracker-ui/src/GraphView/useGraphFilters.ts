// packages/tracker-ui/src/GraphView/useGraphFilters.ts
//
// 关系图过滤面板状态 hook —— 持久化到 localStorage，per app 单独 key。
//
// 过滤维度：
//   - tags: 多选 tag 集合（空 = 不过滤）
//   - statuses: 多选 status 集合（空 = 不过滤）
//   - showOrphans: 显隐孤立节点（refCount = 0），默认 true
//   - minRefCount: 最少入度阈值 [0, maxRefCount]，默认 0（不过滤）
//
// 持久化：JSON 序列化到 localStorage[key]，反序列化失败 / 缺字段时
// fallback 到 initial 值，不抛错。

import { useCallback, useEffect, useState } from 'react'

export interface GraphFilters {
  tags: string[]
  statuses: string[]
  showOrphans: boolean
  minRefCount: number
}

export interface UseGraphFiltersOptions {
  initial?: Partial<GraphFilters>
  /** localStorage key（per app 不同，建议 `${appName}-graph-filters`） */
  storageKey: string
}

const DEFAULT_FILTERS: GraphFilters = {
  tags: [],
  statuses: [],
  showOrphans: true,
  minRefCount: 0
}

/** 持久化只存用户态；showOrphans / minRefCount 也存（用户会调整孤立 + 链接数阈值） */
function loadFilters(key: string, initial: Partial<GraphFilters>): GraphFilters {
  if (typeof window === 'undefined') return { ...DEFAULT_FILTERS, ...initial }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return { ...DEFAULT_FILTERS, ...initial }
    const obj: unknown = JSON.parse(raw)
    if (typeof obj !== 'object' || obj === null) return { ...DEFAULT_FILTERS, ...initial }
    const o = obj as Partial<GraphFilters>
    return {
      tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : [],
      statuses: Array.isArray(o.statuses)
        ? o.statuses.filter((s): s is string => typeof s === 'string')
        : [],
      showOrphans: typeof o.showOrphans === 'boolean' ? o.showOrphans : DEFAULT_FILTERS.showOrphans,
      minRefCount:
        typeof o.minRefCount === 'number' && o.minRefCount >= 0
          ? o.minRefCount
          : DEFAULT_FILTERS.minRefCount
    }
  } catch {
    return { ...DEFAULT_FILTERS, ...initial }
  }
}

function saveFilters(key: string, filters: GraphFilters): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(filters))
  } catch {
    /* 隐私模式 / 配额满 —— 静默忽略 */
  }
}

export interface UseGraphFiltersResult {
  filters: GraphFilters
  setFilters: (next: GraphFilters) => void
  setTags: (tags: string[]) => void
  setStatuses: (statuses: string[]) => void
  setShowOrphans: (v: boolean) => void
  setMinRefCount: (v: number) => void
  resetFilters: () => void
}

export function useGraphFilters(opts: UseGraphFiltersOptions): UseGraphFiltersResult {
  const { initial, storageKey } = opts
  const [filters, setFiltersState] = useState<GraphFilters>(() => loadFilters(storageKey, initial ?? {}))

  /* 持久化 */
  useEffect(() => {
    saveFilters(storageKey, filters)
  }, [storageKey, filters])

  const setFilters = useCallback((next: GraphFilters): void => {
    setFiltersState(next)
  }, [])
  const setTags = useCallback((tags: string[]): void => {
    setFiltersState((f) => ({ ...f, tags }))
  }, [])
  const setStatuses = useCallback((statuses: string[]): void => {
    setFiltersState((f) => ({ ...f, statuses }))
  }, [])
  const setShowOrphans = useCallback((v: boolean): void => {
    setFiltersState((f) => ({ ...f, showOrphans: v }))
  }, [])
  const setMinRefCount = useCallback((v: number): void => {
    setFiltersState((f) => ({ ...f, minRefCount: Math.max(0, v | 0) }))
  }, [])
  const resetFilters = useCallback((): void => {
    setFiltersState({ ...DEFAULT_FILTERS, ...initial })
  }, [initial])

  return {
    filters,
    setFilters,
    setTags,
    setStatuses,
    setShowOrphans,
    setMinRefCount,
    resetFilters
  }
}