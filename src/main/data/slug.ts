/**
 * 生成纯数字 ID：取现有 ID 中的最大数字 + 1。
 * - 非数字 ID（如老 pinyin slug）会被忽略，不参与最大值计算
 * - 数字 ID 之间天然唯一，不需要额外的 collision 处理
 * - 若现有 ID 全是非数字，从 1 开始
 */
export function makeBaseId(existingIds: Iterable<string>): string {
  let max = 0
  for (const id of existingIds) {
    const n = Number(id)
    if (Number.isFinite(n) && n > max && n <= Number.MAX_SAFE_INTEGER) {
      max = Math.floor(n)
    }
  }
  return String(max + 1)
}
