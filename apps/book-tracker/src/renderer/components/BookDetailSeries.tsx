// BookDetail 「所属系列」关联块
//
// 从 BookDetail.tsx 拆出(响应 DSH 插件 700 行/30KB 阈值)。
//
// 位置:在「下一季」区块之后,PrereqEditor 之前。
// 用户核心诉求:"几季 + 衍生作品全部摊开很占空间",
// 在这里汇总同系列的其他作品,方便跨作品跳转。
//
// 三态:
//   1. seriesId 未设 → 「未设置」+ +设置系列 按钮
//   2. seriesId 已设 + currentSeries 存在 → 系列名(可点切换)+ × 移除
//   3. seriesId 已设 + currentSeries 已被删除 → 「原系列已删除 (id: ...)」+ × 清除
//
// 同系列其他作品(去重,排除自己):最多展示 8 本 + overflow 提示;
// 数量小,几十以内(几季 + 衍生),所以不需要分页 / 搜索。

import type { Book, Series } from '@shared/types'
import { WORK_KIND_LABELS } from '@shared/types'
import { SeriesPickerModal } from './SeriesPickerModal'

export interface BookDetailSeriesProps {
  book: Book
  currentSeries: Series | undefined
  seriesSiblings: Book[]
  seriesPickerOpen: boolean
  onOpenSeriesPicker: () => void
  onCloseSeriesPicker: () => void
  onSetSeries: (id: string) => Promise<void>
  onClearSeries: () => Promise<void>
  onSelectBook: (id: string | null) => void
}

const SIBLINGS_PREVIEW_MAX = 8

export function BookDetailSeries(props: BookDetailSeriesProps): JSX.Element {
  const {
    book, currentSeries, seriesSiblings, seriesPickerOpen,
    onOpenSeriesPicker, onCloseSeriesPicker, onSetSeries, onClearSeries, onSelectBook
  } = props

  const previewSiblings = seriesSiblings.slice(0, SIBLINGS_PREVIEW_MAX)
  const overflow = seriesSiblings.length - SIBLINGS_PREVIEW_MAX

  return (
    <section className="series-block">
      <h3 className="series-title">所属系列</h3>
      <div className="series">
        <span className="series-label">所属系列:</span>
        {book.seriesId === undefined || book.seriesId === '' ? (
          <>
            <span className="series-missing">未设置</span>
            <button
              type="button"
              className="series-add"
              onClick={onOpenSeriesPicker}
            >
              + 设置系列
            </button>
          </>
        ) : currentSeries ? (
          <>
            <span
              className="series-link"
              onClick={onOpenSeriesPicker}
              title="点击切换系列"
            >
              {currentSeries.name}
            </span>
            <button
              type="button"
              className="series-remove"
              onClick={() => void onClearSeries()}
              title="移除所属系列"
            >
              ×
            </button>
          </>
        ) : (
          // 引用了已被删除的系列 —— 优雅降级(同 NextSeasonPicker 同款处理)
          <>
            <span className="series-missing">
              原系列已删除 (id: {book.seriesId})
            </span>
            <button
              type="button"
              className="series-remove"
              onClick={() => void onClearSeries()}
              title="清除失效的系列引用"
            >
              × 清除
            </button>
          </>
        )}
      </div>
      {seriesSiblings.length > 0 && (
        <div className="series-siblings">
          <span className="series-siblings-label">
            同系列还有 {seriesSiblings.length} 本:
          </span>
          <ul className="series-siblings-list">
            {previewSiblings.map((b) => (
              <li
                key={b.id}
                className={`kind-${b.kind}`}
                onClick={() => onSelectBook(b.id)}
                title="点击查看详情"
              >
                <span className={`kind-tag kind-${b.kind}`}>
                  {WORK_KIND_LABELS[b.kind]}
                </span>
                <span className="title">{b.title}</span>
                <span className="tracker-id muted">{b.id}</span>
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <p className="muted series-siblings-overflow">
              还有 {overflow} 本未展示 —— 在「+ 添加」→「系列」tab 查看全部系列
            </p>
          )}
        </div>
      )}
      <SeriesPickerModal
        open={seriesPickerOpen}
        onClose={onCloseSeriesPicker}
        onPick={(id) => void onSetSeries(id)}
        currentTitle={book.title}
      />
    </section>
  )
}
