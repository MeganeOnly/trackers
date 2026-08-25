import { useMemo, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useRelationsStore } from '../store/relations'
import { detectCycles } from '@core'
import type { Book, Edge, UnlockRule } from '@shared/types'

interface PrereqEditorProps {
  bookId: string
}

const STATUS_LABELS: Record<Book['status'], string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  finished: '已读',
  abandoned: '弃读'
}

export function PrereqEditor({ bookId }: PrereqEditorProps): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const edges = useRelationsStore((s) => s.edges)
  const setAll = useRelationsStore((s) => s.setAll)
  const select = useBooksStore((s) => s.select)

  const myEdge = edges.find((e) => e.to === bookId)
  const prereqIds = myEdge?.prerequisites ?? []
  const rule: UnlockRule = myEdge?.rule ?? 'all'
  const threshold = myEdge?.threshold ?? prereqIds.length

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const prereqBooks = prereqIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => Boolean(b))
  const missingIds = prereqIds.filter((id) => !books.some((b) => b.id === id))

  const candidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    return books
      .filter((b) => b.id !== bookId)
      .filter((b) => !prereqIds.includes(b.id))
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
      .slice(0, 12)
  }, [books, bookId, prereqIds, pickerQuery])

  async function persist(next: { prerequisites: string[]; rule: UnlockRule; threshold?: number }): Promise<void> {
    const others = edges.filter((e) => e.to !== bookId)
    const newEdge: Edge | null =
      next.prerequisites.length === 0 && next.rule === 'all'
        ? null
        : {
            to: bookId,
            prerequisites: next.prerequisites,
            rule: next.rule,
            ...(next.rule === 'any_of' ? { threshold: next.threshold ?? next.prerequisites.length } : {})
          }
    const updated = newEdge ? [...others, newEdge] : others

    // 写之前做一次环检测
    const cycles = detectCycles(updated)
    const inCycle = cycles.some((c) => c.includes(bookId))
    if (inCycle) {
      alert('此修改会造成循环依赖，请先调整其他前置。')
      return
    }
    await setAll(updated)
  }

  async function remove(id: string): Promise<void> {
    await persist({
      prerequisites: prereqIds.filter((p) => p !== id),
      rule,
      threshold
    })
  }

  async function add(id: string): Promise<void> {
    setPickerOpen(false)
    setPickerQuery('')
    await persist({
      prerequisites: [...prereqIds, id],
      rule,
      threshold
    })
  }

  async function setRule(r: UnlockRule): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: r,
      threshold: r === 'any_of' ? Math.max(1, threshold) : undefined
    })
  }

  async function setThreshold(n: number): Promise<void> {
    await persist({
      prerequisites: prereqIds,
      rule: 'any_of',
      threshold: n
    })
  }

  return (
    <section className="detail-prereqs">
      <h3>
        前置依赖 <span className="muted">({prereqIds.length} 本)</span>
      </h3>

      {prereqIds.length > 0 && (
        <div className="rule-row">
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'all'}
              onChange={() => setRule('all')}
            />
            <span>全部读完才解锁</span>
          </label>
          <label>
            <input
              type="radio"
              name="rule"
              checked={rule === 'any_of'}
              onChange={() => setRule('any_of')}
            />
            <span>至少</span>
            <input
              type="number"
              min={1}
              max={prereqIds.length}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.min(prereqIds.length, Number(e.target.value) || 1)))}
              disabled={rule !== 'any_of'}
              className="threshold-input"
            />
            <span>本解锁</span>
          </label>
        </div>
      )}

      <ul>
        {prereqBooks.map((p) => (
          <li key={p.id} className={`prereq status-${p.status}`}>
            <span className="title" onClick={() => select(p.id)}>{p.title}</span>
            <span className={`status-tag status-${p.status}`}>{STATUS_LABELS[p.status]}</span>
            <button className="prereq-remove" onClick={() => remove(p.id)} title="移除前置">×</button>
          </li>
        ))}
        {missingIds.map((id) => (
          <li key={id} className="prereq prereq-missing">
            <span className="title">{id}</span>
            <span className="muted">未找到</span>
            <button className="prereq-remove" onClick={() => remove(id)}>×</button>
          </li>
        ))}
        {prereqIds.length === 0 && <li className="muted empty-hint">无前置 —— 此书永远解锁</li>}
      </ul>

      <button className="add-prereq" onClick={() => setPickerOpen((v) => !v)}>
        + 添加前置
      </button>

      {pickerOpen && (
        <div className="prereq-picker">
          <input
            type="search"
            placeholder="搜索书名 / 作者..."
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            autoFocus
          />
          <ul>
            {candidates.length === 0 ? (
              <li className="muted">无匹配</li>
            ) : (
              candidates.map((b) => (
                <li key={b.id} onClick={() => add(b.id)}>
                  <span className="title">{b.title}</span>
                  <span className="author muted">{b.author}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </section>
  )
}
