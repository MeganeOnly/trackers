import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { GraphView } from './GraphView'
import { BookCard } from './BookCard'
import { useBooksStore } from '../store/books'

interface GraphModalProps {
  onClose: () => void
  /** BookCard 里点"编辑"时调，用于打开全局 BookForm */
  onEdit: () => void
}

/**
 * Modal 内部状态：当前显示关系图还是某本书的详情卡片
 */
type View = { kind: 'graph' } | { kind: 'card'; bookId: string }

const GRAPH_WIDTH = 1000
const CARD_WIDTH = 760

export function GraphModal({ onClose, onEdit }: GraphModalProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const [view, setView] = useState<View>({ kind: 'graph' })

  // 视图切到 card 时记一笔历史选中，便于图里高亮"刚才点过的那本书"
  function handleSelect(id: string): void {
    setView({ kind: 'card', bookId: id })
  }

  function handleBack(): void {
    setView({ kind: 'graph' })
  }

  // Modal 标题随视图切换：图 → "关系图"；卡 → 书名
  const title = useMemo(() => {
    if (view.kind === 'graph') return '关系图'
    return books.find((b) => b.id === view.bookId)?.title ?? '书详情'
  }, [view, books])

  const width = view.kind === 'graph' ? GRAPH_WIDTH : CARD_WIDTH

  // 重置为 graph 视图当 modal 关闭（避免下次开 modal 时残留 card）
  useEffect(() => {
    return () => setView({ kind: 'graph' })
  }, [])

  return (
    <Modal title={title} onClose={onClose} width={width}>
      <div className="graph-modal-body">
        {view.kind === 'graph' ? (
          <GraphView highlightId={selectedId} onSelect={handleSelect} />
        ) : (
          <BookCard bookId={view.bookId} onEdit={onEdit} onBack={handleBack} />
        )}
      </div>
    </Modal>
  )
}