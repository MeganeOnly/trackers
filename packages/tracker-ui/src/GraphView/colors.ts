// packages/tracker-ui/src/GraphView/colors.ts
//
// 颜色工具 —— 给"按 tag / category 着色"提供稳定的哈希色，
// 同一 tag 永远映射到同一颜色，方便用户记忆。
//
// 算法：djb2-like 哈希 → [0, 360) hue；饱和度 / 明度固定。
// HSL 而不是固定 palette —— 避免碰撞（HSL hue 360 / sat 100 = 1/360 概率相同）。

/** djb2 哈希 → 32-bit 整数 → 取绝对值 */
function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return h | 0
}

/** 哈希字符串到 HSL hue [0, 360) */
export function hashHue(s: string): number {
  return Math.abs(djb2(s)) % 360
}

/** 哈希到固定饱和度/明度的 HSL 字符串色 */
export function tagColor(tag: string): string {
  if (!tag) return '#999999' /* 默认灰 —— 与未解锁一致 */
  const hue = hashHue(tag)
  return `hsl(${hue}, 55%, 52%)`
}

/** 哈希到对比色 —— 用于图例的色卡背景 */
export function tagBgColor(tag: string): string {
  const hue = hashHue(tag)
  return `hsl(${hue}, 35%, 88%)`
}

export type ColorBy = 'status' | 'tag' | 'category' | 'unlock' | 'custom'