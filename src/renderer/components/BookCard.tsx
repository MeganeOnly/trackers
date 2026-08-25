import { BookDetail } from './BookDetail'

interface BookCardProps {
  /** 卡片显示的书 ID（必传 —— 卡片不依赖全局 selectedId） */
  bookId: string
  /** 打开 BookForm 编辑此书 */
  onEdit: () => void
}

/**
 * 关系图右侧的书详情卡片。结构与 EditMode 右侧 BookDetail 一致
 * （功能齐全：状态切换 / 章节进度 / 前置编辑 / 编辑表单入口），
 * 不读写全局 selectedId，因此不会污染 EditMode 里的选中状态。
 */
export function BookCard({ bookId, onEdit }: BookCardProps): JSX.Element {
  return (
    <section className="book-card">
      <BookDetail bookId={bookId} onEdit={onEdit} />
    </section>
  )
}