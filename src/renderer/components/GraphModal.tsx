import { Modal } from './Modal'
import { GraphView } from './GraphView'
import { useBooksStore } from '../store/books'

interface GraphModalProps {
  onClose: () => void
  /** 点击节点时触发：典型用法是关闭 modal + 切到编辑模式让 BookDetail 显示该书 */
  onSelect?: (id: string) => void
}

export function GraphModal({ onClose, onSelect }: GraphModalProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  return (
    <Modal title="关系图" onClose={onClose} width={1000}>
      <div className="graph-modal-body">
        <GraphView highlightId={selectedId} onSelect={onSelect} />
      </div>
    </Modal>
  )
}
