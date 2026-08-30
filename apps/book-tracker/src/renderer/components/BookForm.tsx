import { useState } from 'react'
import { Modal } from './Modal'
import { useBooksStore } from '../store/books'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { Book, BookStatus, WorkKind } from '@shared/types'

interface BookFormProps {
  /** null = 加作品；非空 = 改作品 */
  book: Book | null
  onClose: () => void
}

const STATUS_BASE_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: 'want', label: '想看' },
  { value: 'shelved', label: '搁置' },
  { value: 'reading', label: '在读' },
  { value: 'finished', label: '已读' },
  { value: 'abandoned', label: '弃读' }
]

/**
 * 在看（watching）仅对非电影类型暴露 —— 电影通常一次看完,无需"在看"中间态。
 * 非电影（书 / 动画 / 电视剧 / 其他）作品在已看完后再次观看时,可用此状态代替
 * "在读"措辞更自然。
 */
function statusOptionsFor(kind: WorkKind): { value: BookStatus; label: string }[] {
  if (kind === 'movie') return STATUS_BASE_OPTIONS
  return [...STATUS_BASE_OPTIONS.slice(0, 3), { value: 'watching', label: '在看' }, ...STATUS_BASE_OPTIONS.slice(3)]
}

/**
 * 根据作品类型返回"作者"字段的最佳标签:
 * - book → 作者（默认）
 * - anime / tv → 原作 / 主创（漫画原作、动画监督、电视剧导演等）
 * - movie → 导演
 * - other → 作者 / 主创（兜底）
 */
function authorLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'anime': return '原作 / 主创'
    case 'tv': return '原作 / 主创'
    case 'movie': return '导演'
    case 'other': return '作者 / 主创'
    case 'book': return '作者'
  }
}

/** 译者字段只对书显示（动画/电视剧/电影/其他 通常无译者） */
function translatorLabelFor(kind: WorkKind): string | null {
  return kind === 'book' ? '译者' : null
}

/**
 * 主演字段只对 movie / tv 显示 —— 与"译者"位置对称,UI 不会同时出现两个。
 * anime 没放进来 —— anime 的等价概念是"声优",措辞不一样;用户当前只问 movie/tv。
 */
function starringLabelFor(kind: WorkKind): string | null {
  return kind === 'movie' || kind === 'tv' ? '主演' : null
}

/**
 * 编剧字段只对 movie / tv 显示 —— 与"主演"同属影视主创字段,但各自独立 input
 * (避免"主演 / 编剧"混在同一行的二义)。anime 不放 —— 编剧 vs 原作/漫画作者 不一致。
 */
function screenwriterLabelFor(kind: WorkKind): string | null {
  return kind === 'movie' || kind === 'tv' ? '编剧' : null
}

/** 年份字段按类型给出更具体的标签 */
function yearLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'book': return '出版年份'
    case 'anime': return '开始年份'
    case 'tv': return '首播年份'
    case 'movie': return '上映年份'
    case 'other': return '年份'
  }
}

/** 国家字段对书的语义其实是"原产国"，对影视是"制片国家/地区" */
function countryLabelFor(kind: WorkKind): string {
  return kind === 'book' ? '原产国 / 地区' : '制片国家 / 地区'
}

export function BookForm({ book, onClose }: BookFormProps): JSX.Element {
  const create = useBooksStore((s) => s.create)
  const update = useBooksStore((s) => s.update)
  const remove = useBooksStore((s) => s.remove)
  const defaultWorkKind = useSettingsStore((s) => s.defaultWorkKind)

  const isEdit = book !== null

  const [title, setTitle] = useState(book?.title ?? '')
  const [kind, setKind] = useState<WorkKind>(book?.kind ?? defaultWorkKind)
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
  const [collapsed, setCollapsed] = useState<boolean>(book?.collapsed ?? false)
  const [notes, setNotes] = useState<string>(book?.notes ?? '')
  const [starring, setStarring] = useState<string>(book?.starring ?? '')
  const [screenwriter, setScreenwriter] = useState<string>(book?.screenwriter ?? '')
  const [tagsText, setTagsText] = useState<string>((book?.tags ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!title.trim() || !author.trim()) {
      setError('作品名和作者不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const input: Parameters<typeof create>[0] = {
        title: title.trim(),
        kind,
        author: author.trim(),
        country: country.trim(),
        year: Number(year) || new Date().getFullYear(),
        translator: translator.trim(),
        status,
        progress: null,
        tags: tagsText
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        collapsed,
        notes: notes,
        starring: starring,
        screenwriter: screenwriter
      }
      // 仅当 status 是「进行中」(reading/watching) 且填了 current 时才把 progress 写进 input
      if (status === 'reading' || status === 'watching') {
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
        // 编辑模式下,如果 status 不是「进行中」,主动清空 progress（用户主动清除意图）
        if (status !== 'reading' && status !== 'watching') patch.progress = null
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
      title={isEdit ? `编辑《${book.title}》` : '加作品'}
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
          <span>作品名 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="如：百年孤独 / 进击的巨人 / 星际穿越" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>作品类型</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as WorkKind)}>
              {WORK_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {WORK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{authorLabelFor(kind)} *</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} required />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>{countryLabelFor(kind)}</span>
            <input value={country} onChange={(e) => setCountry(e.target.value)} />
          </label>
          <label className="field">
            <span>{yearLabelFor(kind)}</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              min="0"
              max="9999"
            />
          </label>
        </div>
        {translatorLabelFor(kind) && (
          <label className="field">
            <span>{translatorLabelFor(kind)}</span>
            <input value={translator} onChange={(e) => setTranslator(e.target.value)} />
          </label>
        )}
        {starringLabelFor(kind) && (
          <label className="field">
            <span>{starringLabelFor(kind)}</span>
            <input
              value={starring}
              onChange={(e) => setStarring(e.target.value)}
              placeholder="如：基努·里维斯, 劳伦斯·菲什伯恩"
            />
          </label>
        )}
        {screenwriterLabelFor(kind) && (
          <label className="field">
            <span>{screenwriterLabelFor(kind)}</span>
            <input
              value={screenwriter}
              onChange={(e) => setScreenwriter(e.target.value)}
              placeholder="如：诺兰, 乔纳森·诺兰"
            />
          </label>
        )}
        <div className="field-row">
          <label className="field">
            <span>状态</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as BookStatus)}>
              {statusOptionsFor(kind).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {(status === 'reading' || status === 'watching') && (
            <label className="field">
              <span>第 N 次看</span>
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
              <span>当前进度</span>
              <input
                type="number"
                value={progressCurrent}
                onChange={(e) => setProgressCurrent(e.target.value)}
                min="0"
                placeholder="如 12"
              />
            </label>
            <label className="field">
              <span>总进度（连载/更新中可留空）</span>
              <input
                type="number"
                value={progressTotal}
                onChange={(e) => setProgressTotal(e.target.value)}
                min="1"
                placeholder="如 100；空 = 连载/更新中"
              />
            </label>
          </div>
        )}
        <label className="form-checkline">
          <input
            type="checkbox"
            checked={collapsed}
            onChange={(e) => setCollapsed(e.target.checked)}
          />
          <span title="移到 EditMode 侧栏底部『已收起』分组（所有 status 都允许，纯展示，不影响 status 与解锁）">侧栏收起</span>
        </label>
        <label className="field">
          <span>笔记</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="自由写 —— 心得 / 摘录 / 备忘"
          />
        </label>
        <label className="field">
          <span>标签</span>
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="用逗号分隔 —— 如：科幻, 短篇, 2024"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  )
}
