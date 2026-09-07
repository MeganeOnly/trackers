// 侧栏 series 视图(v2.x 新增)—— 当 BookList.selectedSeriesId !== null 时
// 整左侧栏切到这个视图,展示该系列下的成员。
//
// **职责**:从侧栏入口直接展示 series 元信息 + 成员列表,供用户:
// 1. 跳到成员详情(点 title)—— **左栏保持在本视图**并高亮该成员,便于连续点下一本;
//    退出本视图只有头部「← 返回」一个显式入口
// 2. 一键 × 移除成员(走现有 setSeries IPC,无 confirm,与 BookDetail/SeriesDetailBody 同款)
//
// **设计取舍(粗糙版)**:v2.x 把"展示方式"放进设置项留位置(后续可切换 inline-row / 其它
// 风格),当前只实现 inline-row(inline 展开系列成员)。本视图是 inline-row 模式的
// 「成员列表」子组件。
//
// **不做的(留给后续 / AddModal 内 SeriesView)**:
// - 「+ 添加作品」入口 —— 进 AddModal「+ 系列」tab 完成,侧栏 series 视图保持只读
// - 编辑/删除整个 series —— 同上,避免侧栏加太多按钮
//
// **与现有 SeriesDetailBody 的区别**:SeriesDetailBody 是 AddModal 内的成员管理 body
// (含 + 添加 / × 移除 + 「删除系列」),本组件是侧栏只读版(只展示 + × 移除),
// **不复用 SeriesDetailBody** 因为:
// 1. 视觉上下文不同(侧栏 vs modal)
// 2. 行为子集不同(不要「+ 添加作品」「删除系列」按钮)
// 3. 抽 props 兼容成本不如另写一个 80 行的小组件
//
// **搜索行为**:series 视图展示所有成员,不被 searchStore.query 过滤(用户
// 在系列视图里找的就是该 series 下的全部成员,跟全局搜索正交)。

import { useMemo, useState } from 'react'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, Series } from '@shared/types'

interface SidebarSeriesViewProps {
  series: Series
  books: Book[]
  /** 当前 BookDetail 选中的 book.id —— 高亮对应成员行(语义同 BookList 的 book row.selected) */
  selectedBookId: string | null
  onBack: () => void
  onSelectBook: (bookId: string) => void
  /** 把某个 book 从该 series 移除(走 setSeries(bookId, null)) */
  onRemoveMember: (bookId: string, bookTitle: string) => Promise<void>
  /** 移除中的 book.id —— 灰掉对应 × 按钮避免重复点击 */
  removingId: string | null
}

export function SidebarSeriesView({
  series,
  books,
  selectedBookId,
  onBack,
  onSelectBook,
  onRemoveMember,
  removingId
}: SidebarSeriesViewProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)

  // 派生:属于该系列的 books,按 title 升序(同 SeriesDetailBody)
  const members = useMemo(() => {
    return books
      .filter((b) => b.seriesId === series.id)
      .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }, [books, series.id])

  async function handleRemove(bookId: string, bookTitle: string): Promise<void> {
    setError(null)
    try {
      await onRemoveMember(bookId, bookTitle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="sidebar-series-view">
      <header className="sidebar-series-view-head">
        <button
          type="button"
          className="sidebar-series-view-back"
          onClick={onBack}
          title="返回侧栏"
        >
          ← 返回
        </button>
        <div className="sidebar-series-view-meta">
          <h4 className="sidebar-series-view-name">{series.name}</h4>
          <span className="muted sidebar-series-view-count">{members.length} 本</span>
          <span className="tracker-id muted">{series.id}</span>
        </div>
      </header>

      {series.notes && (
        <p className="sidebar-series-view-notes muted">{series.notes}</p>
      )}

      <div className="sidebar-series-view-toolbar">
        <span className="muted">成员作品:</span>
        <button
          type="button"
          className="sidebar-series-view-add"
          title="到「+ 添加」→「+ 系列」tab 管理成员"
          disabled
        >
          + 添加作品
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}

      {members.length === 0 ? (
        <p className="muted empty-hint">
          这个系列还没有成员 —— 进「+ 添加」→「+ 系列」tab 管理
        </p>
      ) : (
        <ul className="sidebar-series-view-list">
          {members.map((b) => (
            <li
              key={b.id}
              className={`sidebar-series-view-row kind-${b.kind}${selectedBookId === b.id ? ' selected' : ''}${removingId === b.id ? ' is-removing' : ''}`}
              aria-current={selectedBookId === b.id ? 'true' : undefined}
            >
              <span
                className="sidebar-series-view-row-main"
                onClick={() => onSelectBook(b.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectBook(b.id)
                  }
                }}
                aria-label={`打开《${b.title}》详情`}
              >
                <span className={`kind-tag kind-${b.kind}`}>
                  {WORK_KIND_LABELS[b.kind]}
                </span>
                <span className="title">{b.title}</span>
                <span className="author muted">{b.author}</span>
                <span className="tracker-id muted">{b.id}</span>
              </span>
              <button
                type="button"
                className="sidebar-series-view-remove"
                onClick={() => void handleRemove(b.id, b.title)}
                disabled={removingId !== null}
                title={`从「${series.name}」移除《${b.title}》`}
                aria-label={`从「${series.name}」移除《${b.title}》`}
              >
                {removingId === b.id ? '...' : '×'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}