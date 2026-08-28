// 截止日期的「紧迫度」计算 —— life 领域专用纯函数。
//
// 用法：
//   const u = urgencyOf(goal.deadline)
//   // u = 'overdue' | 'urgent' | 'soon' | 'none'
//
// 阈值：
//   overdue：deadline 在今天之前
//   urgent ：deadline 在今天起 7 天内（含今天）
//   soon   ：deadline 在今天起 8~30 天
//   none   ：deadline 在 30 天之后，或 deadline 为空
//
// 所有日期按本地日历日计算（与 deadline 字段的 YYYY-MM-DD 本地语义一致）。
// 不做时区转换 —— 与 GoalDetail / CleanMode 里的 todayStr() 行为对齐。

export type DeadlineUrgency = 'overdue' | 'urgent' | 'soon' | 'none'

/** 紧迫度对应 CleanMode 排序权重（数字越大越靠前）。 */
export const URGENCY_WEIGHT: Record<DeadlineUrgency, number> = {
  overdue: 1000,
  urgent: 500,
  soon: 200,
  none: 0
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 解析 YYYY-MM-DD 字符串为本地零点 Date。解析失败返回 null。 */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  // 用 Date 构造再回读，避免 8 月 31 日 → 9 月这种 JS 静默溢出
  const dt = new Date(year, month - 1, day)
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null
  }
  return dt
}

/** 把 Date 规范化为本地零点（剥掉时分秒）。 */
function startOfLocalDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** 距 deadline 的天数（正数 = 未来，负数 = 逾期）。解析失败返回 null。 */
export function daysUntil(deadline: string, now: Date = new Date()): number | null {
  const target = parseLocalDate(deadline)
  if (!target) return null
  const today = startOfLocalDay(now)
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY)
}

/**
 * 计算 deadline 的紧迫度。
 * - deadline 为 null/空字符串/解析失败 → 'none'
 * - 距今 ≤ 7 天 → 'urgent'
 * - 距今 ≤ 30 天 → 'soon'
 * - 距今 < 0 天 → 'overdue'
 * - 其他 → 'none'
 */
export function urgencyOf(deadline: string | null | undefined, now: Date = new Date()): DeadlineUrgency {
  if (!deadline) return 'none'
  const d = daysUntil(deadline, now)
  if (d === null) return 'none'
  if (d < 0) return 'overdue'
  if (d <= 7) return 'urgent'
  if (d <= 30) return 'soon'
  return 'none'
}
