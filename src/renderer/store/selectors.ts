import { useShallow } from 'zustand/react/shallow'
import { useBooksStore } from './books'
import { useRelationsStore } from './relations'
import { computeUnlocked } from '@shared/unlock'
import type { Book, Edge } from '@shared/types'

export function useUnlocked(): { unlocked: Map<string, boolean>; cycles: string[][] } {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  return computeUnlocked(books, edges)
}

export function useBackReferences(): Map<string, Book[]> {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  const byId = new Map(books.map((b) => [b.id, b]))
  const back = new Map<string, Book[]>()
  for (const e of edges) {
    for (const prereqId of e.prerequisites) {
      if (!back.has(prereqId)) back.set(prereqId, [])
      const target = byId.get(e.to)
      if (target) back.get(prereqId)!.push(target)
    }
  }
  return back
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

export function useEdgeFor(bookId: string | null): Edge | null {
  const edges = useRelationsStore(useShallow((s) => s.edges))
  if (!bookId) return null
  return edges.find((e) => e.to === bookId) ?? null
}
