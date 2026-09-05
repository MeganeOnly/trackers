// 系列徽章 row(v2.x)—— 编辑模式侧栏 status 分组里的「系列」入口行。
//
// **职责**:在 BookList 的某个 status 分组里渲染一行「系列条目」,
// 让用户在不打开 AddModal 的情况下也能从侧栏直接进系列视图。
//
// **视觉 —— 跟 book row 完全统一**(用户诉求:跟 `[动画] 宝石之国` 这种条目一模一样):
// - 同样的 `<li>` 结构 + 同样的 padding / hover / cursor / 选中态反馈
// - 同样的 kind-tag(只是文字换成「系列」+ 配色换成系列专属紫调)
// - 同样的 title 字段(系列名)
// - 同样的右侧 read-count 槽位(展示 `(N 本)`)
// - 同样的 tracker-id(系列 id)
//
// 唯一的扩展是「选中」语义」**跟 book row 共享同一套视觉反馈** —— 因为 series row
// 的「展开」语义(切到 series 视图)跟 book row 的「选中」(显示 BookDetail)同属
// "侧栏里这一项当前处于焦点态",视觉统一 = 一致的认知负担。
//
// **行为**:
// - 单击/回车 → 父组件 BookList 把 selectedSeriesId 设为 this.series.id,
//   整左侧栏切到 SidebarSeriesView,展示该系列成员
// - 选中态 = this.series.id === expanded(从 BookList 传进来)→ 加 `.selected`,
//   跟 book row 的 `selected` 走同一套 li 样式
//
// **grid 模式说明**:v2.x 暂时只在 list / focus-stack 模式下展示 series row
// (grid 模式下整个 book 列表走卡片墙,series row 没法整齐地嵌进卡片网格里);
//   留后续若用户用 grid 时也要看到 series 再补 —— 当前 grid 模式直接不渲染。
//
// **共享边界**:纯 UI 组件,无领域字段;tracker-core / Rust / crates/tracker-core
// 零改动。

import type { Series } from '@shared/types'

interface SeriesRowInSidebarProps {
  series: Series
  /** 该 series 下所有作品总数(跨 status) —— 展示在右侧 (N 本) 槽位 */
  memberCount: number
  /** 当前侧栏是否展开到该 series(高亮,语义同 book row.selected) */
  expanded: boolean
  /** 点击 父组件切到 SidebarSeriesView */
  onClick: (seriesId: string) => void
}

export function SeriesRowInSidebar({
  series,
  memberCount,
  expanded,
  onClick
}: SeriesRowInSidebarProps): JSX.Element {
  function handleClick(): void {
    onClick(series.id)
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLLIElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <li
      className={`kind-series${expanded ? ' selected' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-pressed={expanded}
      aria-label={`打开系列「${series.name}」(${memberCount} 本)`}
      title="点击查看该系列下的作品"
    >
      <span className="kind-tag kind-series">系列</span>
      <span className="title">{series.name}</span>
      <span className="read-count">({memberCount} 本)</span>
      <span className="tracker-id">{series.id}</span>
    </li>
  )
}