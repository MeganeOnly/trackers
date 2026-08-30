// apps/life-tracker/src/shared/categoryColor.ts
//
// 把 goal.category 字符串映射到 theme CSS variable (--cat-*),
// 给 Codex 主题的列表项左侧 4px 装饰条用。
//
// category 是开放 string 字段(用户填的"学业/事业/健康/..."),
// 不能写 enum 枚举,只能 mapping + fallback var(--cat-other)。
//
// 用法(JSX inline style):
//   <li style={{ '--item-stripe': categoryVar(g.category) } as React.CSSProperties}>

/** category → CSS var 的小写归一化 map。命中不到时 fallback `var(--cat-other)`(灰色) */
const CAT_MAP: Record<string, string> = {
  学业: 'var(--cat-academic)',
  学术: 'var(--cat-academic)',
  研究: 'var(--cat-academic)',
  事业: 'var(--cat-career)',
  工作: 'var(--cat-career)',
  职业: 'var(--cat-career)',
  健康: 'var(--cat-health)',
  健身: 'var(--cat-health)',
  运动: 'var(--cat-health)',
  个人: 'var(--cat-personal)',
  生活: 'var(--cat-personal)',
  财务: 'var(--cat-career)',
  经济: 'var(--cat-career)'
}

export function categoryVar(category: string): string {
  return CAT_MAP[category] ?? 'var(--cat-other)'
}
