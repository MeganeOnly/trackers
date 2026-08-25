import matter from 'gray-matter'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, ensureDir } from './files'
import { makeBaseId } from './slug'
import {
  bumpProgress as bumpProgressHelper,
  normalizeProgressInput,
  parseProgress
} from '@shared/progress'
import type { Book, BookInput, BookStatus, Progress } from '@shared/types'

const VALID_STATUS: BookStatus[] = ['want', 'shelved', 'reading', 'finished', 'abandoned']

function isValidStatus(s: unknown): s is BookStatus {
  return typeof s === 'string' && (VALID_STATUS as string[]).includes(s)
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 列出所有书的 ID（从文件名读） */
export async function listBookIds(booksDir: string): Promise<string[]> {
  await ensureDir(booksDir)
  const files = await fs.readdir(booksDir)
  return files.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
}

/** 读取一本书 */
export async function readBook(booksDir: string, id: string): Promise<Book | null> {
  const filePath = path.join(booksDir, `${id}.md`)
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    if (!isValidStatus(data.status)) throw new Error(`invalid status: ${data.status}`)
    return normalizeBook(id, data)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** 批量读取所有书（跳过损坏文件，返回损坏列表） */
export async function readAllBooks(
  booksDir: string
): Promise<{ books: Book[]; broken: { id: string; error: string }[] }> {
  const ids = await listBookIds(booksDir)
  const books: Book[] = []
  const broken: { id: string; error: string }[] = []
  for (const id of ids) {
    try {
      const b = await readBook(booksDir, id)
      if (b) books.push(b)
    } catch (err) {
      broken.push({ id, error: (err as Error).message })
    }
  }
  return { books, broken }
}

function normalizeBook(id: string, data: Record<string, unknown>): Book {
  return {
    id,
    title: String(data.title ?? ''),
    author: String(data.author ?? ''),
    country: String(data.country ?? ''),
    year: Number(data.year ?? 0),
    translator: String(data.translator ?? ''),
    status: data.status as BookStatus,
    read_count: Number(data.read_count ?? 1),
    progress: parseProgress(data.progress),
    created: String(data.created ?? nowIso()),
    updated: String(data.updated ?? nowIso()),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : []
  }
}

/** 写入一本书（覆盖或新建）。返回最终写入的 Book（含 id） */
export async function writeBook(
  booksDir: string,
  input: BookInput,
  existingIds: Set<string>
): Promise<Book> {
  const id = makeBaseId(existingIds)
  const now = nowIso()
  const book: Book = {
    id,
    title: input.title,
    author: input.author,
    country: input.country,
    year: input.year,
    translator: input.translator,
    status: input.status,
    read_count: 1,
    progress: normalizeProgressInput(input.progress),
    created: now,
    updated: now,
    tags: input.tags ?? []
  }
  await persist(booksDir, book)
  return book
}

/** 更新一本书（按 id），保留 created，只刷新 updated */
export async function updateBook(
  booksDir: string,
  id: string,
  patch: Partial<BookInput> & { read_count?: number; tags?: string[]; progress?: BookInput['progress'] }
): Promise<Book> {
  const existing = await readBook(booksDir, id)
  if (!existing) throw new Error(`book not found: ${id}`)
  const merged: Book = {
    ...existing,
    ...patch,
    id,
    progress: 'progress' in patch ? normalizeProgressInput(patch.progress) : existing.progress,
    created: existing.created,
    updated: nowIso()
  }
  await persist(booksDir, merged)
  return merged
}

/**
 * 快速调整 progress.current：service 层使用。
 * - 当前没有 progress：初始化为 { current: max(delta, 1), total: null }
 * - delta > 0：递增 current
 * - delta < 0：递减 current，下限 0（0 表示刚开始读 / 还没读）
 * - 读不到书：抛错
 */
export async function bumpProgress(
  booksDir: string,
  id: string,
  delta: number
): Promise<Book> {
  const existing = await readBook(booksDir, id)
  if (!existing) throw new Error(`book not found: ${id}`)
  const next = bumpProgressHelper(existing.progress, delta)
  return updateBook(booksDir, id, { progress: next })
}

/** 删除一本书 */
export async function deleteBook(booksDir: string, id: string): Promise<void> {
  const filePath = path.join(booksDir, `${id}.md`)
  await fs.unlink(filePath)
}

async function persist(booksDir: string, book: Book): Promise<void> {
  const body = `# ${book.title}\n\n## 笔记\n\n## 摘录\n`
  const fm: Record<string, unknown> = {
    id: book.id,
    title: book.title,
    author: book.author,
    country: book.country,
    year: book.year,
    translator: book.translator,
    status: book.status,
    read_count: book.read_count,
    created: book.created,
    updated: book.updated,
    tags: book.tags
  }
  // 只在有 progress 时写——避免无意义字段污染 frontmatter
  if (book.progress) fm.progress = book.progress
  const content = matter.stringify(body, fm)
  await atomicWriteFile(path.join(booksDir, `${book.id}.md`), content)
}
