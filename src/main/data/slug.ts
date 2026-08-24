import { pinyin } from 'pinyin-pro'

/**
 * 生成 slug：{作者姓-pinyin}-{标题-pinyin}-{年份}
 * - 仅保留 ASCII 字母/数字/-/
 * - 冲突由调用方追加 -2/-3
 */
export function makeBaseSlug(author: string, title: string, year: number): string {
  const authorSeg = toAscii(author).replace(/\s+/g, '-')
  const titleSeg = toAscii(title).replace(/\s+/g, '-')
  return `${authorSeg}-${titleSeg}-${year}`.toLowerCase()
}

/** 中英混合转 pinyin / 小写 ASCII，去除非字母数字 */
function toAscii(input: string): string {
  // 整段先转 pinyin（无音调、空格分隔）
  const py = pinyin(input, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
  return py
    .map((seg) => seg.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('-')
}
