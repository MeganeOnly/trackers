import { BookDetail } from './BookDetail'

interface BookCardProps {
  /** 卡片显示的书 ID（必传 —— 卡片不依赖全局 selectedId） */
  bookId: string
  /** 关闭右侧详情（回到纯图）；传了就渲染卡片右上角的 × */
  onClose?: () => void
}

/**
 * 关系图右侧的书详情卡片。结构与 EditMode 右侧 BookDetail 一致
 * （功能齐全：状态 / 章节进度 / 前置编辑 / 字段内联可编辑），
 * 不读写全局 selectedId，因此不会污染 EditMode 里的选中状态。
 */
export function BookCard({ bookId, onClose }: BookCardProps): JSX.Element {
  return (
    <section className="book-card">
      {onClose && (
        <button
          className="book-card-close"
          onClick={onClose}
          aria-label="关闭右侧详情"
          title="关闭右侧详情"
        >
          ×
        </button>
      )}
      <BookDetail bookId={bookId} />
    </section>
  )
}
