import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { BookForm } from './components/BookForm'
import { useModeStore } from './store/mode'
import { useBooksStore } from './store/books'
import { useRelationsStore } from './store/relations'
import type { Book } from '@shared/types'

type FormState = { mode: 'add' } | { mode: 'edit'; book: Book } | null

export default function App(): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  const loadBooks = useBooksStore((s) => s.load)
  const loadRelations = useRelationsStore((s) => s.load)
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const select = useBooksStore((s) => s.select)

  const [form, setForm] = useState<FormState>(null)

  useEffect(() => {
    window.electron.config
      .get()
      .then((cfg) => useModeStore.getState().hydrate(cfg))
      .catch((e) => console.error('config load failed:', e))
    loadBooks()
    loadRelations()
  }, [loadBooks, loadRelations])

  function openAdd(): void {
    select(null)
    setForm({ mode: 'add' })
  }
  function openEdit(): void {
    const b = books.find((x) => x.id === selectedId)
    if (!b) return
    setForm({ mode: 'edit', book: b })
  }

  return (
    <div className="app-shell">
      <TopBar onAdd={openAdd} />
      <div className="app-body">
        <EditModeWrapper onEdit={openEdit} />
      </div>
      {form && <BookForm book={form.mode === 'edit' ? form.book : null} onClose={() => setForm(null)} />}
    </div>
  )
}

function EditModeWrapper({ onEdit }: { onEdit: () => void }): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  return mode === 'edit' ? <EditMode onEdit={onEdit} /> : <CleanMode />
}
