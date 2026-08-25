import { Modal } from './Modal'
import { GraphView } from './GraphView'
import { BookCardContainer } from './BookCardContainer'

interface GraphModalProps {
  onClose: () => void
  /** BookCard 里点"编辑"时调，用于打开全局 BookForm */
  onEdit: () => void
}

/**
 * 双栏布局：
 * - 左侧：关系图（flex 2 / 较宽）
 * - 右侧：BookCardContainer，跟随全局 selectedId 显示对应书的详情
 *
 * GraphView.onNodeClick 直接更新 booksStore.selectedId，右侧自动重渲染，
 * GraphModal 不持有任何本地视图状态。
 */
const SPLIT_WIDTH = 1200

export function GraphModal({ onClose, onEdit }: GraphModalProps): JSX.Element {
  return (
    <Modal title="关系图" onClose={onClose} width={SPLIT_WIDTH}>
      <div className="graph-modal-split">
        <div className="graph-modal-pane-left">
          <GraphView />
        </div>
        <div className="graph-modal-pane-right">
          <BookCardContainer onEdit={onEdit} />
        </div>
      </div>
    </Modal>
  )
}