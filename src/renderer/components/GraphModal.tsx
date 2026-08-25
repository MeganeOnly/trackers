import { useEffect } from 'react'
import { Modal } from './Modal'
import { GraphView } from './GraphView'
import { BookCardContainer } from './BookCardContainer'
import { useBooksStore } from '../store/books'

interface GraphModalProps {
  onClose: () => void
  /** BookCard 里点"编辑"时调，用于打开全局 BookForm */
  onEdit: () => void
}

/**
 * 关系图布局：
 * - 初次打开：纯图（GRAPH_WIDTH，更紧凑，让画布占满）
 * - 点击节点：自动切到左右分栏（SPLIT_WIDTH，右侧显示 BookCard）
 * - 右栏 X 按钮：select(null) 回到纯图
 *
 * GraphView.onNodeClick 已经直接更新 booksStore.selectedId，
 * 这里读 selectedId 即可驱动布局切换。
 */
const SPLIT_WIDTH = 1200
const GRAPH_WIDTH = 880

export function GraphModal({ onClose, onEdit }: GraphModalProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const bookExists = useBooksStore(
    (s) => (selectedId ? s.books.some((b) => b.id === selectedId) : false)
  )
  const select = useBooksStore((s) => s.select)
  const showSplit = selectedId !== null && bookExists

  // 每次打开都重置为纯图；点击节点后由 GraphView.onNodeClick 触发 select 切到分栏
  useEffect(() => {
    select(null)
    // 只在挂载时重置一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal
      title="关系图"
      onClose={onClose}
      width={showSplit ? SPLIT_WIDTH : GRAPH_WIDTH}
      className="modal-card--graph"
    >
      {showSplit ? (
        <div className="graph-modal-split">
          <div className="graph-modal-pane-left">
            <GraphView />
          </div>
          <div className="graph-modal-pane-right">
            <div className="graph-modal-pane-header">
              <button
                className="graph-modal-pane-close"
                onClick={() => select(null)}
                aria-label="关闭右侧详情"
                title="关闭右侧详情"
              >
                ×
              </button>
            </div>
            <BookCardContainer onEdit={onEdit} />
          </div>
        </div>
      ) : (
        <div className="graph-modal-full">
          <GraphView />
        </div>
      )}
    </Modal>
  )
}