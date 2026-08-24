import type { Book, BookInput } from '@shared/types'
import { getDataDir } from './data-dir'
import {
  listBookIds,
  readAllBooks,
  readBook,
  writeBook as ioWriteBook,
  updateBook as ioUpdateBook,
  deleteBook as ioDeleteBook
} from '../data/books'

export type BrokenEntry = { id: string; error: string }

export async function listBooks(): Promise<{ books: Book[]; broken: BrokenEntry[] }> {
  const dir = getDataDir()
  const booksDir = `${dir}/books`
  return readAllBooks(booksDir)
}

export async function getBook(id: string): Promise<Book | null> {
  const dir = getDataDir()
  return readBook(`${dir}/books`, id)
}

export async function createBook(input: BookInput): Promise<Book> {
  const dir = getDataDir()
  const ids = new Set(await listBookIds(`${dir}/books`))
  return ioWriteBook(`${dir}/books`, input, ids)
}

export async function updateBook(
  id: string,
  patch: Partial<BookInput> & { read_count?: number; tags?: string[] }
): Promise<Book> {
  const dir = getDataDir()
  return ioUpdateBook(`${dir}/books`, id, patch)
}

export async function deleteBook(id: string): Promise<void> {
  const dir = getDataDir()
  return ioDeleteBook(`${dir}/books`, id)
}
