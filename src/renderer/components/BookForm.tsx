import { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { useBooksStore } from '../store/books'
import type { Book, BookStatus } from '@shared/types'

interface BookFormProps {
  /** null = 加书；非空 = 改书 */
  book: Book | null
  onClose: () => void
}

const STATUS_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: 'want', label: '想看' },
  { value: 'shelved', label: '搁置' },
  { value: 'reading', label: '在读' },
  { value: 'finished', label: '已读' },
  { value: 'abandoned', label: '弃读' }
]

export function BookForm({ book, onClose }: BookFormProps): JSX.Element {
  const create = useBooksStore((s) => s.create)
  const update = useBooksStore((s) => s.update)
  const remove = useBooksStore((s) => s.remove)

  const isEdit = book !== null

  const [title, setTitle] = useState(book?.title ?? '')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [country, setCountry] = useState(book?.country ?? '')
  const [year, setYear] = useState<string>(book?.year ? String(book.year) : '')
  const [translator, setTranslator] = useState(book?.translator ?? '')
  const [status, setStatus] = useState<BookStatus>(book?.status ?? 'want')
  const [readCount, setReadCount] = useState<number>(book?.read_count ?? 1)
  // 章节进度（仅 status === 'reading' 时提交到 input）
  const [progressCurrent, setProgressCurrent] = useState<string>(
    book?.progress?.current !== undefined ? String(book.progress.current) : ''
  )
  const [progressTotal, setProgressTotal] = useState<string>(
    book?.progress?.total !== undefined && book.progress.total !== null
      ? String(book.progress.total)
      : ''
  )
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!book) return
    // 读 .md 文件 body 作为初始 notes
    void book.id
    setNotes('')
  }, [book])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!title.trim() || !author.trim()) {
      setError('书名和作者不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Parameters<typeof create>[0] = {
        title: title.trim(),
        author: author.trim(),
        country: country.trim(),
        year: Number(year) || new Date().getFullYear(),
        translator: translator.trim(),
        status,
        progress: null,
        tags: []
      }
      // 仅当 status === 'reading' 且填了 current 时才把 progress 写进 input
      if (status === 'reading') {
        const c = Number(progressCurrent)
        if (progressCurrent.trim() !== '' && Number.isFinite(c) && c >= 0) {
          const tRaw = progressTotal.trim()
          const t = tRaw === '' ? null : Number(tRaw)
          input.progress = {
            current: Math.floor(c),
            total: t !== null && Number.isFinite(t) && t > 0 ? Math.floor(t) : null
          }
        }
      }
      if (isEdit && book) {
        const patch: Parameters<typeof update>[1] = { ...input, read_count: readCount }
        // 编辑模式下，如果 status 不是 reading，主动清空 progress（用户主动清除意图）
        if (status !== 'reading') patch.progress = null
        await update(book.id, patch)
      } else {
        await create(input)
      }
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!book) return
    if (!confirm(`删除《${book.title}》？关联关系也会失效（relations.json 不会自动清理）。`)) return
    setBusy(true)
    try {
      await remove(book.id)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `编辑《${book.title}》` : '加书'}
      onClose={onClose}
      width={600}
      backdropClassName="modal-backdrop--top"
      footer={
        <div className="form-footer">
          {isEdit && (
            <button type="button" className="btn-danger" onClick={handleDelete} disabled={busy}>
              删除
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" form="book-form" className="btn-primary" disabled={busy}>
            {busy ? '保存中...' : '保存'}
          </button>
        </div>
      }
    >
      <form id="book-form" onSubmit={handleSubmit} className="book-form">
        <label className="field">
          <span>书名 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span>作者 *</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} required />
        </label>
        <div className="field-row">
          <label className="field">
            <span>国家</span>
            <input value={country} onChange={(e) => setCountry(e.target.value)} />
          </label>
          <label className="field">
            <span>年份</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              min="0"
              max="9999"
            />
          </label>
        </div>
        <label className="field">
          <span>译者</span>
          <input value={translator} onChange={(e) => setTranslator(e.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>状态</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as BookStatus)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {status === 'reading' && (
            <label className="field">
              <span>第 N 次读</span>
              <input
                type="number"
                value={readCount}
                onChange={(e) => setReadCount(Math.max(1, Number(e.target.value) || 1))}
                min="1"
              />
            </label>
          )}
        </div>
        {status === 'reading' && (
          <div className="field-row progress-fields">
            <label className="field">
              <span>当前章节</span>
              <input
                type="number"
                value={progressCurrent}
                onChange={(e) => setProgressCurrent(e.target.value)}
                min="0"
                placeholder="如 12"
              />
            </label>
            <label className="field">
              <span>总章节（连载中可留空）</span>
              <input
                type="number"
                value={progressTotal}
                onChange={(e) => setProgressTotal(e.target.value)}
                min="1"
                placeholder="如 100；空 = 连载中"
              />
            </label>
          </div>
        )}
        <label className="field">
          <span>笔记 (Markdown)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="## 章节笔记..."
          />
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
