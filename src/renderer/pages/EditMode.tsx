import { BookList } from '../components/BookList'
import { BookDetail } from '../components/BookDetail'

interface EditModeProps {
  onEdit: () => void
}

export function EditMode({ onEdit }: EditModeProps): JSX.Element {
  return (
    <div className="page-edit">
      <aside className="sidebar">
        <BookList />
      </aside>
      <main className="detail-panel">
        <BookDetail onEdit={onEdit} />
      </main>
    </div>
  )
}
