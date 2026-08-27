import { useBooksStore } from './books'
import { useRelationsStore } from './relations'
import { computeUnlocked } from '@core'
import type { Book } from '@shared/types'

export function useUnlocked(): { unlocked: Map<string, boolean>; cycles: string[][] } {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  // book-tracker 没有 countable 任务 —— 引用次数参数直接忽略
  return computeUnlocked(
    books.map((b) => b.id),
    edges,
    (id, _requiredCount) => books.some((b) => b.id === id && b.status === 'finished')
  )
}

export function useGroupedByStatus(): Record<Book['status'], Book[]> {
  const books = useBooksStore((s) => s.books)
  const groups: Record<Book['status'], Book[]> = {
    want: [],
    shelved: [],
    reading: [],
    finished: [],
    abandoned: []
  }
  for (const b of books) groups[b.status].push(b)
  for (const k of Object.keys(groups) as Book['status'][]) {
    groups[k].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }
  return groups
}
