import { BookList } from '../components/BookList'
import { BookDetail } from '../components/BookDetail'

export function EditMode(): JSX.Element {
  return (
    <div className="page-edit">
      <aside className="sidebar">
        <BookList />
      </aside>
      <main className="detail-panel">
        <BookDetail />
      </main>
    </div>
  )
}
