import { useEffect, useState } from 'react'
import { TopBar } from './components/TopBar'
import { EditMode } from './pages/EditMode'
import { CleanMode } from './pages/CleanMode'
import { BookForm } from './components/BookForm'
import { GraphModal } from './components/GraphModal'
import { useModeStore } from './store/mode'
import { useBooksStore } from './store/books'
import { useRelationsStore } from './store/relations'
import { useSearchStore } from './store/search'
import type { Book } from '@shared/types'

type FormState = { mode: 'add' } | { mode: 'edit'; book: Book } | null

export default function App(): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  const loadBooks = useBooksStore((s) => s.load)
  const loadRelations = useRelationsStore((s) => s.load)
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const select = useBooksStore((s) => s.select)
  const clearSearch = useSearchStore((s) => s.clear)

  const [form, setForm] = useState<FormState>(null)
  const [graphOpen, setGraphOpen] = useState(false)

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

  // 全局快捷键（input/textarea 焦点时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'n') {
        e.preventDefault()
        openAdd()
      } else if (key === 'g') {
        e.preventDefault()
        setGraphOpen((v) => !v)
      } else if (key === 'e') {
        e.preventDefault()
        useModeStore.getState().setMode('edit')
      } else if (key === 'c') {
        e.preventDefault()
        useModeStore.getState().setMode('clean')
      } else if (e.key === 'Escape') {
        clearSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, selectedId])

  return (
    <div className="app-shell">
      <TopBar onAdd={openAdd} onGraph={() => setGraphOpen(true)} />
      <div className="app-body">
        <EditModeWrapper onEdit={openEdit} />
      </div>
      {form && (
        <BookForm book={form.mode === 'edit' ? form.book : null} onClose={() => setForm(null)} />
      )}
      {graphOpen && (
        <GraphModal
          onClose={() => setGraphOpen(false)}
          onSelect={() => {
            // 节点点击后：GraphView 已经 set 了 selectedId，这里关 modal + 切到 edit 模式，
            // 让 EditMode 里的 BookDetail 渲染这本书
            setGraphOpen(false)
            useModeStore.getState().setMode('edit')
          }}
        />
      )}
    </div>
  )
}

function EditModeWrapper({ onEdit }: { onEdit: () => void }): JSX.Element {
  const mode = useModeStore((s) => s.mode)
  return mode === 'edit' ? <EditMode onEdit={onEdit} /> : <CleanMode />
}
