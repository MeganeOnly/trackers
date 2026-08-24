import { Modal } from './Modal'
import { GraphView } from './GraphView'
import { useBooksStore } from '../store/books'

interface GraphModalProps {
  onClose: () => void
}

export function GraphModal({ onClose }: GraphModalProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  return (
    <Modal title="关系图" onClose={onClose} width={1000}>
      <div className="graph-modal-body">
        <GraphView highlightId={selectedId} />
      </div>
    </Modal>
  )
}
