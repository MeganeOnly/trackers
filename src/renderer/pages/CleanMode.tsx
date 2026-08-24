import { useMemo } from 'react'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { useUnlocked } from '../store/selectors'
import type { Book } from '@shared/types'

export function CleanMode(): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)
  const edges = useRelationsStore((s) => s.edges)
  const { unlocked } = useUnlocked()

  const list = useMemo(() => {
    // 反向度数：被多少本书当作前置
    const refCount = new Map<string, number>()
    for (const b of books) refCount.set(b.id, 0)
    for (const e of edges) {
      for (const prereq of e.prerequisites) {
        refCount.set(prereq, (refCount.get(prereq) ?? 0) + 1)
      }
    }
    return books
      .filter((b) => b.status !== 'finished' && b.status !== 'abandoned')
      .filter((b) => unlocked.get(b.id))
      .map((book) => ({ book, refCount: refCount.get(book.id) ?? 0 }))
      .sort((a, b) => {
        // 反向度数高者优先（基础书靠前）
        if (b.refCount !== a.refCount) return b.refCount - a.refCount
        return a.book.title.localeCompare(b.book.title, 'zh')
      })
  }, [books, edges, unlocked])

  const currentlyReading = books.find((b) => b.status === 'reading')

  async function markFinished(id: string): Promise<void> {
    await update(id, { status: 'finished' })
  }

  return (
    <div className="page-clean">
      <header className="clean-header">
        <h2>现在能读的书 ({list.length})</h2>
        {currentlyReading && (
          <p className="currently-reading">
            正在读: <strong>{currentlyReading.title}</strong>
            {currentlyReading.read_count > 1 && ` · 第 ${currentlyReading.read_count} 次`}
          </p>
        )}
      </header>

      {list.length === 0 ? (
        <p className="muted empty-hint">暂无未读已解锁的书。先在右侧编辑模式加几本。</p>
      ) : (
        <ul className="clean-list">
          {list.map(({ book, refCount }) => (
            <li key={book.id} className="clean-item">
              <span className="title">{book.title}</span>
              <span className="author muted">{book.author}</span>
              {refCount > 0 && <span className="ref-badge">解锁 {refCount} 本</span>}
              <button className="quick-finish" onClick={() => markFinished(book.id)} title="标记为已读">
                读完
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
