import { useMemo } from 'react'
import { useBooksStore } from './books'
import { useRelationsStore } from './relations'
import { computeBlockingRelations, computeUnlocked } from '@core'
import type { BlockingRelation } from '@core'
import type { Book } from '@shared/types'

export function useUnlocked(): {
  unlocked: Map<string, boolean>
  cycles: string[][]
  /** 每个 id 的直接双向邻居：blocks（我解锁后能推动谁）/ blockedBy（还卡在谁上） */
  relations: Map<string, BlockingRelation>
} {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  // book-tracker 没有 countable 任务 —— 引用次数参数直接忽略
  const unlocked = computeUnlocked(
    books.map((b) => b.id),
    edges,
    (id, _requiredCount) => books.some((b) => b.id === id && b.status === 'finished')
  )
  // 与 unlock 同步算 —— 同样的 edges 输入,O(E) 一次扫描
  const relations = useMemo(() => computeBlockingRelations(edges), [edges])
  return { ...unlocked, relations }
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
