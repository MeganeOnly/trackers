import type { Progress } from './types'

/**
 * 从 frontmatter 原始值规整成 Progress | null。
 * 容错策略：
 * - 缺字段 / 类型不对 / current 非数/负 → null（current 是核心，没了就没意义）
 * - total=0/负/非数 → fallback 为 total=null（保留 current，UI 显示"连载中"）
 * 这样用户 total 填错也不会丢进度数据。
 */
export function parseProgress(raw: unknown): Progress | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const c = Number(obj.current)
  if (!Number.isFinite(c) || c < 0) return null
  const tRaw = obj.total
  if (tRaw === null || tRaw === undefined) return { current: Math.floor(c), total: null }
  const t = Number(tRaw)
  if (!Number.isFinite(t) || t <= 0) return { current: Math.floor(c), total: null }
  return { current: Math.floor(c), total: Math.floor(t) }
}

/** 把用户/表单输入的 progress 规整为 Progress | null（同样容错：total 异常 fallback 为 null）。 */
export function normalizeProgressInput(p: Progress | null | undefined): Progress | null {
  if (p === null || p === undefined) return null
  const c = Number(p.current)
  if (!Number.isFinite(c) || c < 0) return null
  if (p.total === null || p.total === undefined) {
    return { current: Math.floor(c), total: null }
  }
  const t = Number(p.total)
  if (!Number.isFinite(t) || t <= 0) return { current: Math.floor(c), total: null }
  return { current: Math.floor(c), total: Math.floor(t) }
}

/** 把 progress 渲染成 "12 / 100" / "12 章 · 连载中" / "" */
export function formatProgress(p: Progress | null | undefined): string {
  if (!p) return ''
  if (p.total !== null) return `${p.current} / ${p.total}`
  if (p.current > 0) return `${p.current} 章 · 连载中`
  return ''
}

/** 0-100 进度百分比；total=null 或 total<=0 时返回 0 */
export function progressPercent(p: Progress | null | undefined): number {
  if (!p || !p.total || p.total <= 0) return 0
  return Math.min(100, Math.max(0, (p.current / p.total) * 100))
}

/**
 * 快速调整 current：service 层使用。
 * - 当前没有 progress：初始化为 { current: max(delta, 1), total: null }
 * - delta > 0：递增
 * - delta < 0：递减，下限 0
 */
export function bumpProgress(current: Progress | null, delta: number): Progress {
  const cur = current?.current ?? 0
  const next = Math.max(0, cur + delta)
  return current
    ? { current: next, total: current.total }
    : { current: Math.max(1, next), total: null }
}