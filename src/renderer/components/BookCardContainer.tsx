import { useBooksStore } from '../store/books'
import { BookCard } from './BookCard'

interface BookCardContainerProps {
  /** BookCard 内点"编辑"时调，打开全局 BookForm */
  onEdit: () => void
}

/**
 * 关系图右侧的卡片容器：跟随全局 selectedId 自动渲染对应书的详情。
 * - 已选中 → 渲染 BookCard
 * - 未选中 → 显示提示（让用户知道怎么用）
 */
export function BookCardContainer({ onEdit }: BookCardContainerProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const bookExists = useBooksStore((s) => (selectedId ? s.books.some((b) => b.id === selectedId) : false))

  if (!selectedId || !bookExists) {
    return (
      <div className="book-card-empty muted">
        <p>← 点左侧图中的节点查看这本书的详情</p>
        <p className="hint">所有操作（状态切换 / 进度 / 前置 / 编辑）都在这里</p>
      </div>
    )
  }

  return <BookCard bookId={selectedId} onEdit={onEdit} />
}