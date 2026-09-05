// 「系列详情」body(无 Modal 包装)—— 由 SeriesView 在 view === 'detail' 时渲染。
//
// **职责**:展示某个 series 的元信息 + 成员作品列表 + 「+ 添加作品」入口。
// **为什么抽出来**:与 BookFormFields / SeriesView 同款 —— AddModal 是唯一 Modal,
// 本组件必须不含 Modal 包装,否则 Modal 内嵌 Modal(v1.8 已踩坑)。
//
// **成员列表**:派生自 books store,过滤 `b.seriesId === series.id`,
// 按 title 升序(用 localeCompare 'zh' 跟 wikilink / RankingList 同款 ——
// 不在测试中断言具体顺序,跨平台 ICU 稳定)。每行带「× 移除」按钮。
//
// **移除交互**:直接调 `setSeries(book.id, null)`,后端走现有 `books_set_series`
// IPC(Rust 端无校验,直接清空),前端 books store 通过 upsertBook 自动更新。
// 无需 confirm —— 跟 BookDetail 的 × 移除系列同款(用户点一次就生效)。
//
// **添加入口**:底部「+ 添加作品」按钮 → 父组件 SeriesView 切到 'picker' view,
// 由 SeriesPickBooksBody 承载多选逻辑。

import { useMemo } from 'react'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, Series } from '@shared/types'

interface SeriesDetailBodyProps {
  series: Series
  books: Book[]
  onBack: () => void
  onPickAdd: () => void
  onRemoveMember: (bookId: string, bookTitle: string) => Promise<void>
  /** 移除中的 book.id(灰掉对应行的 × 按钮避免重复点击) */
  removingId: string | null
}

export function SeriesDetailBody({
  series,
  books,
  onBack,
  onPickAdd,
  onRemoveMember,
  removingId
}: SeriesDetailBodyProps): JSX.Element {
  // 派生:属于该系列的 books,按 title 升序
  const members = useMemo(() => {
    return books
      .filter((b) => b.seriesId === series.id)
      .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }, [books, series.id])

  return (
    <div className="series-detail-body">
      <div className="series-detail-head">
        <button
          type="button"
          className="series-detail-back"
          onClick={onBack}
          title="返回系列列表"
        >
          ← 返回
        </button>
        <div className="series-detail-meta">
          <h4 className="series-detail-name">{series.name}</h4>
          <span className="muted series-detail-count">
            {members.length} 本
          </span>
          <span className="tracker-id muted">{series.id}</span>
        </div>
      </div>
      {series.notes && (
        <p className="series-detail-notes muted">{series.notes}</p>
      )}

      <div className="series-detail-toolbar">
        <span className="muted">成员作品:</span>
        <button
          type="button"
          className="btn-primary"
          onClick={onPickAdd}
          disabled={removingId !== null}
        >
          + 添加作品
        </button>
      </div>

      {members.length === 0 ? (
        <p className="muted empty-hint">
          这个系列还没有成员 —— 点上方「+ 添加作品」
        </p>
      ) : (
        <ul className="series-detail-list">
          {members.map((b) => (
            <li key={b.id} className={`series-detail-row kind-${b.kind}`}>
              <span className={`kind-tag kind-${b.kind}`}>
                {WORK_KIND_LABELS[b.kind]}
              </span>
              <span className="title">{b.title}</span>
              <span className="author muted">{b.author}</span>
              <span className="tracker-id muted">{b.id}</span>
              <button
                type="button"
                className="series-detail-remove"
                onClick={() => void onRemoveMember(b.id, b.title)}
                disabled={removingId !== null}
                title={`从「${series.name}」移除《${b.title}》`}
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
