import { create } from 'zustand'
import type { Book, BookInput } from '@shared/types'

interface BooksState {
  books: Book[]
  broken: { id: string; error: string }[]
  selectedId: string | null
  loading: boolean
  load: () => Promise<void>
  select: (id: string | null) => void
  create: (input: BookInput) => Promise<Book>
  update: (id: string, patch: Partial<BookInput> & { read_count?: number; tags?: string[] }) => Promise<Book>
  remove: (id: string) => Promise<void>
}

export const useBooksStore = create<BooksState>((set, get) => ({
  books: [],
  broken: [],
  selectedId: null,
  loading: false,
  load: async () => {
    set({ loading: true })
    try {
      const { books, broken } = await window.electron.books.list()
      set({ books, broken, loading: false })
    } catch (e) {
      console.error('books load failed:', e)
      set({ loading: false })
    }
  },
  select: (id) => set({ selectedId: id }),
  create: async (input) => {
    const book = await window.electron.books.create(input)
    set((s) => ({ books: [...s.books, book] }))
    return book
  },
  update: async (id, patch) => {
    const book = await window.electron.books.update(id, patch)
    set((s) => ({ books: s.books.map((b) => (b.id === id ? book : b)) }))
    return book
  },
  remove: async (id) => {
    await window.electron.books.delete(id)
    set((s) => ({
      books: s.books.filter((b) => b.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId
    }))
  }
}))
