import { useEffect, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useUnlocked } from '../store/selectors'
import { PrereqEditor } from './PrereqEditor'
import { EpisodesPanel } from './EpisodesPanel'
import { progressPercent } from '@core'
import { formatProgress } from '@shared/progress'
import { StampChip } from '@ui/StampChip'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { Book, BookInput, BookStatus, WorkKind } from '@shared/types'

interface BookDetailProps {
  /** 显式指定显示哪本书；不传则用全局 selectedId */
  bookId?: string
}

const STATUS_LABELS: Record<BookStatus, string> = {
  want: '想看',
  shelved: '搁置',
  reading: '在读',
  watching: '在看',
  finished: '已读',
  abandoned: '弃读'
}

const STATUS_BASE_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: 'want', label: '想看' },
  { value: 'shelved', label: '搁置' },
  { value: 'reading', label: '在读' },
  { value: 'finished', label: '已读' },
  { value: 'abandoned', label: '弃读' }
]

/** 在看（watching）仅对非电影类型暴露,见 BookForm 同名函数注释 */
function statusOptionsFor(kind: WorkKind): { value: BookStatus; label: string }[] {
  if (kind === 'movie') return STATUS_BASE_OPTIONS
  return [...STATUS_BASE_OPTIONS.slice(0, 3), { value: 'watching', label: '在看' }, ...STATUS_BASE_OPTIONS.slice(3)]
}

// 类型相关字段标签 —— 详情内联编辑的 label 要和加作品表单一致,
// 共享函数搬到 shared 段成本不划算,这里就近复制一份
function authorLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'anime': return '原作 / 主创'
    case 'tv': return '原作 / 主创'
    case 'movie': return '导演'
    case 'other': return '作者 / 主创'
    case 'book': return '作者'
  }
}
function translatorLabelFor(kind: WorkKind): string | null {
  return kind === 'book' ? '译者' : null
}
function starringLabelFor(kind: WorkKind): string | null {
  return kind === 'movie' || kind === 'tv' ? '主演' : null
}
function screenwriterLabelFor(kind: WorkKind): string | null {
  return kind === 'movie' || kind === 'tv' ? '编剧' : null
}
function yearLabelFor(kind: WorkKind): string {
  switch (kind) {
    case 'book': return '出版年份'
    case 'anime': return '开始年份'
    case 'tv': return '首播年份'
    case 'movie': return '上映年份'
    case 'other': return '年份'
  }
}
function countryLabelFor(kind: WorkKind): string {
  return kind === 'book' ? '原产国 / 地区' : '制片国家 / 地区'
}

/**
 * 编辑模式右侧的书详情 = 内联可编辑表单：
 * - 所有字段直接可编辑，点「保存」统一写盘，不再需要额外的「编辑」弹窗
 * - 无章节进度（progress === null）时只显示读完/没读完，不显示章节进度条
 * - 前置依赖编辑器与进度快捷调整（-1/+1/+5/读完）保留在下方
 */
export function BookDetail({ bookId }: BookDetailProps): JSX.Element {
  const selectedId = useBooksStore((s) => s.selectedId)
  const books = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)
  const bumpProgress = useBooksStore((s) => s.bumpProgress)
  const remove = useBooksStore((s) => s.remove)
  const select = useBooksStore((s) => s.select)
  const effectiveId = bookId ?? selectedId
  const book = books.find((b) => b.id === effectiveId)
  const { unlocked, cycles } = useUnlocked()

  const [title, setTitle] = useState(book?.title ?? '')
  const [kind, setKind] = useState<WorkKind>(book?.kind ?? 'book')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [country, setCountry] = useState(book?.country ?? '')
  const [year, setYear] = useState<string>(book?.year ? String(book.year) : '')
  const [translator, setTranslator] = useState(book?.translator ?? '')
  const [status, setStatus] = useState<BookStatus>(book?.status ?? 'want')
  const [readCount, setReadCount] = useState<number>(book?.read_count ?? 1)
  const [progressCurrent, setProgressCurrent] = useState<string>(
    book?.progress?.current !== undefined ? String(book.progress.current) : ''
  )
  const [progressTotal, setProgressTotal] = useState<string>(
    book?.progress?.total !== undefined && book.progress.total !== null ? String(book.progress.total) : ''
  )
  const [collapsed, setCollapsed] = useState<boolean>(book?.collapsed ?? false)
  const [notes, setNotes] = useState<string>(book?.notes ?? '')
  const [starring, setStarring] = useState<string>(book?.starring ?? '')
  const [screenwriter, setScreenwriter] = useState<string>(book?.screenwriter ?? '')
  const [tagsText, setTagsText] = useState<string>((book?.tags ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 切换条目时重置草稿（未保存的输入随之丢弃，与旧「弹窗编辑」语义一致）
  useEffect(() => {
    setTitle(book?.title ?? '')
    setKind(book?.kind ?? 'book')
    setAuthor(book?.author ?? '')
    setCountry(book?.country ?? '')
    setYear(book?.year ? String(book.year) : '')
    setTranslator(book?.translator ?? '')
    setStatus(book?.status ?? 'want')
    setReadCount(book?.read_count ?? 1)
    setProgressCurrent(book?.progress?.current !== undefined ? String(book.progress.current) : '')
    setProgressTotal(
      book?.progress?.total !== undefined && book.progress.total !== null ? String(book.progress.total) : ''
    )
    setCollapsed(book?.collapsed ?? false)
    setNotes(book?.notes ?? '')
    setStarring(book?.starring ?? '')
    setScreenwriter(book?.screenwriter ?? '')
    setTagsText((book?.tags ?? []).join(', '))
    setError(null)
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id])

  if (!book) {
    return (
      <div className="detail-empty">
        <p className="muted">从左侧选一个作品，或点右上角 + 加作品。</p>
      </div>
    )
  }
  // 窄化别名：TS 的 narrowing 不会传播进下面的嵌套函数声明，统一用 cur
  const cur = book

  const isUnlocked = unlocked.get(cur.id) ?? true
  const cycle = cycles.find((c) => c.includes(cur.id))
  const pct = progressPercent(cur.progress)

  async function handleBump(delta: number): Promise<void> {
    const updated = await bumpProgress(cur.id, delta)
    setProgressCurrent(updated.progress?.current !== undefined ? String(updated.progress.current) : '')
    setProgressTotal(
      updated.progress?.total !== undefined && updated.progress.total !== null ? String(updated.progress.total) : ''
    )
  }

  async function handleFinish(): Promise<void> {
    setStatus('finished')
    await update(cur.id, { status: 'finished' })
  }

  async function handleSave(): Promise<void> {
    if (!title.trim() || !author.trim()) {
      setError('作品名和作者不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // 仅当 status 是「进行中」(reading/watching) 且填了 current 时才把 progress 写进 patch；
      // 其余情况一律视为 null —— patch.progress 默认为 null，省去冗余二次赋值。
      let progress: BookInput['progress'] = null
      if (status === 'reading' || status === 'watching') {
        const c = Number(progressCurrent)
        if (progressCurrent.trim() !== '' && Number.isFinite(c) && c >= 0) {
          const tRaw = progressTotal.trim()
          const t = tRaw === '' ? null : Number(tRaw)
          progress = {
            current: Math.floor(c),
            total: t !== null && Number.isFinite(t) && t > 0 ? Math.floor(t) : null
          }
        }
      }
      const patch: Partial<BookInput> & {
        read_count?: number
        tags?: string[]
        progress?: BookInput['progress']
        collapsed?: boolean
        notes?: string
        starring?: string
        screenwriter?: string
      } = {
        title: title.trim(),
        kind,
        author: author.trim(),
        country: country.trim(),
        year: Number(year) || new Date().getFullYear(),
        translator: translator.trim(),
        status,
        progress,
        read_count: readCount,
        tags: tagsText
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        collapsed,
        notes,
        starring,
        screenwriter
      }
      await update(cur.id, patch)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!confirm(`删除《${cur.title}》？关联关系也会失效（relations.json 不会自动清理）。`)) return
    setBusy(true)
    setError(null)
    try {
      await remove(cur.id)
      select(null)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <article className="book-detail">
      <header className="detail-header">
        <input
          className="detail-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="作品名"
        />
        <div className="meta-row">
          {status === 'finished' ? (
            <StampChip label={STATUS_LABELS[status]} state="finished" />
          ) : (
            <span className={`status-pill status-${status}`}>
              {STATUS_LABELS[status]}
              {(status === 'reading' || status === 'watching') && ` · 第 ${readCount} 次`}
            </span>
          )}
          {!isUnlocked && !cycle && <span className="lock-pill">未解锁</span>}
          {cycle && <span className="lock-pill error">循环依赖</span>}
        </div>
      </header>

      {(status === 'reading' || status === 'watching') && book.progress !== null && (
        <section className="progress-card">
          <div className="progress-card-header">
            <span className="progress-label">进度</span>
            <span className="progress-text">{formatProgress(book.progress) || '尚未记录'}</span>
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-actions">
            <button className="btn-secondary" onClick={() => void handleBump(-1)} title="回退 1 章">
              -1
            </button>
            <button className="btn-secondary" onClick={() => void handleBump(+1)} title="推进 1">
              +1
            </button>
            <button className="btn-secondary" onClick={() => void handleBump(+5)} title="推进 5">
              +5
            </button>
            <button className="quick-finish" onClick={() => void handleFinish()}>
              看完
            </button>
          </div>
        </section>
      )}

      <div className="detail-form">
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
        <div className="field-row">
          <label className="field">
            <span>{authorLabelFor(kind)}</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="作者名 / 导演名 / 主创名" />
          </label>
          {translatorLabelFor(kind) && (
            <label className="field">
              <span>{translatorLabelFor(kind)}</span>
              <input value={translator} onChange={(e) => setTranslator(e.target.value)} placeholder="如：范晔" />
            </label>
          )}
          {starringLabelFor(kind) && (
            <label className="field">
              <span>{starringLabelFor(kind)}</span>
              <input value={starring} onChange={(e) => setStarring(e.target.value)} placeholder="如：基努·里维斯, 劳伦斯·菲什伯恩" />
            </label>
          )}
          {screenwriterLabelFor(kind) && (
            <label className="field">
              <span>{screenwriterLabelFor(kind)}</span>
              <input value={screenwriter} onChange={(e) => setScreenwriter(e.target.value)} placeholder="如：诺兰, 乔纳森·诺兰" />
            </label>
          )}
        </div>
        <div className="field-row">
          <label className="field">
            <span>{countryLabelFor(kind)}</span>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="如：中国" />
          </label>
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
        </div>
        {(status === 'reading' || status === 'watching') && (
          <div className="field-row">
            <label className="field">
              <span>第 N 次看</span>
              <input
                type="number"
                value={readCount}
                onChange={(e) => setReadCount(Math.max(1, Number(e.target.value) || 1))}
                min="1"
              />
            </label>
          </div>
        )}
        {(status === 'reading' || status === 'watching') && (
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
      </div>

      {/* 集笔记 —— 仅 tv/anime 显示,放在前置依赖之前(用户最关心的进度信息) */}
      {(kind === 'tv' || kind === 'anime') && <EpisodesPanel book={cur} />}

      <PrereqEditor bookId={book.id} />

      <footer className="detail-footer">
        <button className="btn-danger" onClick={handleDelete} disabled={busy}>
          删除
        </button>
        <div className="spacer" />
        <button className="btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? '保存中...' : saved ? '已保存' : '保存'}
        </button>
      </footer>
    </article>
  )
}
