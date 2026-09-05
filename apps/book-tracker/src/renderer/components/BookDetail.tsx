import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useUnlocked } from '../store/selectors'
import { PrereqEditor } from './PrereqEditor'
import { EpisodesPanel } from './EpisodesPanel'
import { CharactersPanel } from './CharactersPanel'
import { NextSeasonPicker } from './NextSeasonPicker'
import { SeriesPickerModal } from './SeriesPickerModal'
import { useSeriesStore } from '../store/series'
import { WikilinkText } from './WikilinkText'
import { useWikilinkTextarea } from './useWikilinkTextarea'
import { InlineField, type InlineFieldOption } from './InlineField'
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
  // v1.6 「下一季」action —— 走专用 IPC(同 seasons / episodes / characters 模式)
  const setNextSeason = useBooksStore((s) => s.setNextSeason)
  // v2.x 「上一季」主动设 action —— 走专用 IPC,带粘性标记
  const setPrevSeason = useBooksStore((s) => s.setPrevSeason)
  // v1.7 「所属系列」action —— 走专用 IPC
  const setSeries = useBooksStore((s) => s.setSeries)
  // v1.7 读 series 列表(BookDetail 显示所属系列名 + SeriesPickerModal 候选用)
  const seriesList = useSeriesStore((s) => s.series)
  const loadSeries = useSeriesStore((s) => s.load)
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
  // 笔记「预览 ↔ 编辑」二态 —— 默认预览(WikilinkText),点「笔记」标题切到 textarea;
  // textarea blur 切回预览。切换作品时重置回预览。
  const [noteEditing, setNoteEditing] = useState(false)
  // v2.x:notesDirty 标记 —— 用户是否在 BookDetail 端改过主笔记(未保存)。
  // BookNotesModal 可独立保存主笔记(booksStore.update patch notes),
  // 当 store 里的 book.notes 被外部更新时:
  // - dirty=false:本地草稿未动 → 同步刷新到本地(用户能看到 modal 的最新结果)
  // - dirty=true :本地有用户未保存输入 → 不覆盖,保留本地草稿(避免 modal 的
  //   保存动作把用户的输入吞掉)
  const [notesDirty, setNotesDirty] = useState(false)
  const [starring, setStarring] = useState<string>(book?.starring ?? '')
  const [screenwriter, setScreenwriter] = useState<string>(book?.screenwriter ?? '')
  const [tagsText, setTagsText] = useState<string>((book?.tags ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // v1.6 「下一季」picker 开关(受控传给 NextSeasonPicker)
  // v2.x:季节 picker 统一状态 —— 一次只开一个,mode 区分 prev/next 共用 NextSeasonPicker 组件
  // null = 全关;'next' = 选下一季;'prev' = 选上一季(顶部多"没有上一季"项)
  const [seasonPickerMode, setSeasonPickerMode] = useState<null | 'next' | 'prev'>(null)
  // v1.7 「所属系列」picker 开关(受控传给 SeriesPickerModal)
  const [seriesPickerOpen, setSeriesPickerOpen] = useState(false)
  // v2.x 详情页字段 inline edit 状态:一次只编辑一个字段(null = 全预览)。
  // 编辑控件由 InlineField 渲染,父组件统一管理避免多个白框同时打开。
  const [editingField, setEditingField] = useState<string | null>(null)

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
    setNoteEditing(false)
    // 切换作品 → 重置 dirty(新作品的本地 draft 等于它的 book.notes)
    setNotesDirty(false)
    setStarring(book?.starring ?? '')
    setScreenwriter(book?.screenwriter ?? '')
    setTagsText((book?.tags ?? []).join(', '))
    setError(null)
    setSaved(false)
    // 切换作品时关闭 picker(避免开 picker 状态下切到另一部)
    setSeasonPickerMode(null)
    setSeriesPickerOpen(false)
    // 切作品 → 关掉所有 inline 编辑态(切到新作品从预览开始,符合"切换 = 重置草稿"语义)
    setEditingField(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id])

  // v2.x:外部 notes 更新(典型来源:BookNotesModal 独立保存)同步到本地 draft。
  // 仅在「本地未编辑」时同步,避免覆盖用户正在编辑的草稿。
  // BookDetail 自己保存触发的 book.notes 变化也走这里 —— 此时 notesDirty 仍为
  // true(用户刚保存,本地与 store 暂时同步),effect 不写入(无害:本地 draft
  // 等于新 store 值),紧跟 handleSave 里的 setNotesDirty(false) 让后续外部
  // 更新能正常同步。
  useEffect(() => {
    if (notesDirty) return
    setNotes(book?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.notes])

  // ★ hooks 必须无条件调用 —— useMemo 必须在 early return 之前。
  // 否则切换「未选条目 → 选了条目」时 React 看到 hook 数量变化,直接抛
  // "Rendered more hooks than during the previous render"。
  // book 可能 undefined(从集合里找不到),内部用 optional chaining 兜底。
  // v1.6 「下一季」—— 当前 book.nextSeasonId 引用的目标 book(可能已被删除 → undefined)
  const nextSeasonBook = useMemo(
    () => (book?.nextSeasonId ? books.find((b) => b.id === book.nextSeasonId) : undefined),
    [books, book?.nextSeasonId]
  )
  // v1.6 「上一季」—— 当前 book.prevSeasonId 引用的目标 book(可能已被删除 → undefined);
  // 由 service 层在 set_next_season 路径自动维护(双向同步),前端不主动设 prevSeasonId
  const prevSeasonBook = useMemo(
    () => (book?.prevSeasonId ? books.find((b) => b.id === book.prevSeasonId) : undefined),
    [books, book?.prevSeasonId]
  )
  // v1.7 「所属系列」—— 当前 book.seriesId 引用的 series(可能已被删除 → undefined)
  const currentSeries = useMemo(
    () => (book?.seriesId ? seriesList.find((s) => s.id === book.seriesId) : undefined),
    [seriesList, book?.seriesId]
  )
  // v1.7 「所属系列」关联下的同系列其他作品 —— 用户从 BookDetail 可跳到同系列
  // 其他作品(主功能诉求:"几季 + 衍生作品全部摊开很占空间")。
  // 派生:books 里 seriesId == cur.seriesId 且 id !== cur.id 的所有 books
  const seriesSiblings = useMemo(() => {
    if (!book?.seriesId) return []
    return books.filter((b) => b.seriesId === book.seriesId && b.id !== book.id)
  }, [books, book?.seriesId, book?.id])
  // picker 候选:排除自己;tv/anime 优先(但不硬约束跨类型);按 title 升序;
  // **不截断** —— 之前 `.slice(0, 12)` 会让排在第 13+ 的同前缀书名
  // (如「鉴证实录II」在「鉴证实录」之后)进不到 picker,
  // 用户在 picker 里搜索时(NextSeasonPicker 内部 filter)只能在这 12 个里
  // 找,自然搜不到。picker 已经有 max-height + overflow-y 滚动,
  // 搜索框按 title / author 过滤,全量候选对 UX 无害。
  // 关联决策见 apps/book-tracker/AGENTS.md §十.28 / docs/dev-notes.md 2026-09。
  const nextSeasonCandidates = useMemo(() => {
    if (!book) return []
    return books
      .filter((b) => b.id !== book.id)
      .sort((a, b) => {
        // tv / anime 优先
        const aTv = a.kind === 'tv' || a.kind === 'anime' ? 0 : 1
        const bTv = b.kind === 'tv' || b.kind === 'anime' ? 0 : 1
        if (aTv !== bTv) return aTv - bTv
        return a.title.localeCompare(b.title, 'zh')
      })
  }, [books, book?.id])

  // v1.7 wikilink —— `[[` 触发 picker + 预览
  // book undefined 时 hook 内部不触发 picker(Rules of Hooks 要求提前调用)
  // v2.x:setValue 包一层,顺便把 notesDirty 设为 true(用户主动改本地草稿)
  const setNotesWithDirty = useCallback((v: string): void => {
    setNotes(v)
    setNotesDirty(true)
  }, [])
  const { handleChange: handleNotesChange, taRef: notesTaRef } = useWikilinkTextarea({
    book,
    value: notes,
    setValue: setNotesWithDirty
  })

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

  async function handleSetNextSeason(id: string): Promise<void> {
    setSeasonPickerMode(null)
    if (id === cur.id) return // self-loop 兜底(Rust 也会拒绝,这里双保险)
    try {
      await setNextSeason(cur.id, id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleClearNextSeason(): Promise<void> {
    try {
      await setNextSeason(cur.id, null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // v2.x 「上一季」主动设/清除(走专用 IPC,带粘性标记)
  // id === '' 表示 prev 模式 picker 顶部"没有上一季"项被选中
  async function handleSetPrevSeason(id: string): Promise<void> {
    setSeasonPickerMode(null)
    if (id === cur.id) return // self-loop 兜底
    try {
      await setPrevSeason(cur.id, id === '' ? null : id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleClearPrevSeason(): Promise<void> {
    try {
      await setPrevSeason(cur.id, null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // v1.7 「所属系列」handlers
  async function handleSetSeries(seriesId: string): Promise<void> {
    setSeriesPickerOpen(false)
    try {
      await setSeries(cur.id, seriesId)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleClearSeries(): Promise<void> {
    try {
      await setSeries(cur.id, null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // v1.7 「所属系列」—— 打开 picker 前确保 series 列表已加载
  function openSeriesPicker(): void {
    if (seriesList.length === 0) {
      void loadSeries()
    }
    setSeriesPickerOpen(true)
  }

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
      // v2.x:本地 draft 已写盘 → 重置 dirty 标志,允许后续外部 notes 更新同步回来
      setNotesDirty(false)
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
        {/* v2.x 字段 inline 预览/编辑二态 —— 默认无背景显示值,点开后变白框。
            沿用底部「保存」统一写盘(本地 useState 暂存),切换作品 / Esc / blur 退出编辑。
            笔记保留独立 inline 模式(自带 wikilink picker 等特化交互,不适合走通用 InlineField)。 */}
        <div className="field-row">
          <InlineField
            fieldId="kind"
            label="作品类型"
            display={WORK_KIND_LABELS[kind]}
            value={kind}
            onChange={(v) => setKind(v as WorkKind)}
            kind="select"
            options={WORK_KIND_ORDER.map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))}
            editing={editingField === 'kind'}
            onActivate={() => setEditingField('kind')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder=""
          />
          <InlineField
            fieldId="year"
            label={yearLabelFor(kind)}
            display={year}
            value={year}
            onChange={setYear}
            kind="number"
            editing={editingField === 'year'}
            onActivate={() => setEditingField('year')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
            min={0}
            max={9999}
          />
        </div>
        <div className="field-row">
          <InlineField
            fieldId="author"
            label={authorLabelFor(kind)}
            display={author}
            value={author}
            onChange={setAuthor}
            kind="text"
            editing={editingField === 'author'}
            onActivate={() => setEditingField('author')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
          {translatorLabelFor(kind) && (
            <InlineField
              fieldId="translator"
              label={translatorLabelFor(kind)!}
              display={translator}
              value={translator}
              onChange={setTranslator}
              kind="text"
              editing={editingField === 'translator'}
              onActivate={() => setEditingField('translator')}
              onDeactivate={() => setEditingField(null)}
              emptyPlaceholder="未设置"
            />
          )}
          {starringLabelFor(kind) && (
            <InlineField
              fieldId="starring"
              label={starringLabelFor(kind)!}
              display={starring}
              value={starring}
              onChange={setStarring}
              kind="text"
              editing={editingField === 'starring'}
              onActivate={() => setEditingField('starring')}
              onDeactivate={() => setEditingField(null)}
              emptyPlaceholder="未设置"
            />
          )}
          {screenwriterLabelFor(kind) && (
            <InlineField
              fieldId="screenwriter"
              label={screenwriterLabelFor(kind)!}
              display={screenwriter}
              value={screenwriter}
              onChange={setScreenwriter}
              kind="text"
              editing={editingField === 'screenwriter'}
              onActivate={() => setEditingField('screenwriter')}
              onDeactivate={() => setEditingField(null)}
              emptyPlaceholder="未设置"
            />
          )}
        </div>
        <div className="field-row">
          <InlineField
            fieldId="country"
            label={countryLabelFor(kind)}
            display={country}
            value={country}
            onChange={setCountry}
            kind="text"
            editing={editingField === 'country'}
            onActivate={() => setEditingField('country')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder="未设置"
          />
          <InlineField
            fieldId="status"
            label="状态"
            display={STATUS_LABELS[status]}
            value={status}
            onChange={(v) => setStatus(v as BookStatus)}
            kind="select"
            options={statusOptionsFor(kind).map((o) => ({ value: o.value, label: o.label }))}
            editing={editingField === 'status'}
            onActivate={() => setEditingField('status')}
            onDeactivate={() => setEditingField(null)}
            emptyPlaceholder=""
          />
        </div>
        {(status === 'reading' || status === 'watching') && (
          <div className="field-row">
            <InlineField
              fieldId="readCount"
              label="第 N 次看"
              display={String(readCount)}
              value={String(readCount)}
              onChange={(v) => setReadCount(Math.max(1, Number(v) || 1))}
              // 输入时同步归一化,避免中间态(v='')导致 readCount=1 然后用户松开手再敲变成 0
              normalize={(v) => String(Math.max(1, Number(v) || 1))}
              kind="number"
              editing={editingField === 'readCount'}
              onActivate={() => setEditingField('readCount')}
              onDeactivate={() => setEditingField(null)}
              emptyPlaceholder=""
              min={1}
            />
          </div>
        )}
        {(status === 'reading' || status === 'watching') && (
          <div className="field-row progress-fields">
            <InlineField
              fieldId="progressCurrent"
              label="当前进度"
              display={progressCurrent}
              value={progressCurrent}
              onChange={setProgressCurrent}
              kind="number"
              editing={editingField === 'progressCurrent'}
              onActivate={() => setEditingField('progressCurrent')}
              onDeactivate={() => setEditingField(null)}
              emptyPlaceholder="未设置"
              min={0}
            />
            <InlineField
              fieldId="progressTotal"
              label="总进度"
              display={progressTotal}
              value={progressTotal}
              onChange={setProgressTotal}
              kind="number"
              editing={editingField === 'progressTotal'}
              onActivate={() => setEditingField('progressTotal')}
              onDeactivate={() => setEditingField(null)}
              emptyPlaceholder="未设置"
              min={1}
            />
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
        {/* 笔记 —— 默认预览(WikilinkText),点「笔记」标题切到 textarea 编辑;
            textarea blur 切回预览。预览/编辑二态互斥,符合"非编辑就是只读"心智。
            笔记保留独立 inline 模式(自带 wikilink picker 等特化交互,不适合走通用 InlineField)。 */}
        <div className="field note-field">
          <span
            className={`note-field-toggle${noteEditing ? ' is-editing' : ''}`}
            role="button"
            tabIndex={0}
            title={noteEditing ? '编辑中 —— 点外部或失焦返回预览' : '点击进入编辑'}
            onClick={() => setNoteEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setNoteEditing(true)
              }
            }}
          >
            笔记{!noteEditing && <span className="note-field-edit-hint">点击编辑</span>}
          </span>
          {noteEditing ? (
            <textarea
              ref={notesTaRef}
              value={notes}
              onChange={handleNotesChange}
              onBlur={() => setNoteEditing(false)}
              onKeyDown={(e) => {
                // Esc 也切回预览(避免用户点 textarea 外部只能依赖鼠标 blur)
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setNoteEditing(false)
                  ;(e.currentTarget as HTMLTextAreaElement).blur()
                }
              }}
              rows={6}
              autoFocus
              placeholder="自由写 —— 心得 / 摘录 / 备忘(输入 [[ 触发角色选择)"
            />
          ) : (
            /* v1.7 wikilink 预览 —— 解析 notes 里的 [[xxx]] 成可点击链接 */
            <WikilinkText
              text={notes}
              currentBook={cur}
              allBooks={books}
              className="wikilink-preview-block"
            />
          )}
        </div>
        <InlineField
          fieldId="tags"
          label="标签"
          display={tagsText}
          value={tagsText}
          onChange={setTagsText}
          kind="text"
          editing={editingField === 'tags'}
          onActivate={() => setEditingField('tags')}
          onDeactivate={() => setEditingField(null)}
          emptyPlaceholder="点击设置 标签（用逗号分隔）"
        />
        {error && <p className="form-error">{error}</p>}
      </div>

      {/* 集笔记 —— 仅 tv/anime 显示,放在前置依赖之前(用户最关心的进度信息) */}
      {(kind === 'tv' || kind === 'anime') && <EpisodesPanel book={cur} />}

      {/* 角色笔记 —— 所有类型都能用(v1.5 起);在集笔记 / detail-form 之后,前置依赖之前 */}
      <CharactersPanel book={cur} />

      {/* v2.x 「上一季 / 下一季」合并为一条两列 grid(左=上一季,右=下一季,无中间分隔线 —— 用户嫌细线多余)。
          - 镜像布局:左半边整体靠左(label 在最左 = "上一季" 自身最左);
            右半边镜像(整组靠右,label 在最右 = "下一季" 自身最右)——
            用 flex-direction: row-reverse + justify-content: flex-end 实现
          - 镜像布局:左半边整体靠左(label 在最左 = "上一季" 自身最左);
            右半边镜像(整组靠右,label 在最右 = "下一季" 自身最右)——
            用 flex-direction: row-reverse + justify-content: flex-end 实现
          - 极简交互:每侧只有 label + 内容 + 可选×;没有「改」按钮(要改先×再+)
          - prev 三态:
            1. prevSeasonId 未设 + prevSeasonExplicit=false → "未设置" → label + +设置按钮
            2. prevSeasonId 已设 + prevSeasonExplicit=true(主动设)或 prevSeasonId 显式 Some
              → "已设 prev" → label + content + ×
            3. prevSeasonId = None + prevSeasonExplicit=true → "明确没有上一季"
              → label + 空 + ×(视觉上跟"未设置"区分:有×无+)
            视觉上 (2) 和 (3) 都有 × 按钮,区别只在 content 有没有值
          - next 简化:只有「未设」和「已设」两态(service 路径固定单向,不需要 explicit 标记) */}
      <section className="season-pair-block">
        <div className="season-pair">
          {/* 左侧:上一季 —— 整体靠左,label 在最左 */}
          <div className="prev-season">
            <span className="prev-season-label">上一季</span>
            {/* prev "已设"判断:prevSeasonExplicit=true(主动设了 None 或 Some)
                或 prevSeasonId 是 Some —— 任何"用户/数据明确指向某 prev"的状态 */}
            {cur.prevSeasonExplicit === true ||
            (cur.prevSeasonId !== undefined && cur.prevSeasonId !== '') ? (
              // 已设(可能是某个 prev 或明确"没有")
              <>
                {prevSeasonBook ? (
                  <span
                    className="prev-season-link"
                    onClick={() => select(prevSeasonBook.id)}
                    title="点击跳到该作品"
                  >
                    {prevSeasonBook.title}
                  </span>
                ) : cur.prevSeasonId ? (
                  // prevSeasonId 有值但书被删了 —— 优雅降级
                  <span className="prev-season-missing">
                    原作品已删除 (id: {cur.prevSeasonId})
                  </span>
                ) : (
                  // prevSeasonId 是 None + prevSeasonExplicit=true → 明确"没有上一季"
                  // 视觉上 content 区为空(不显示文字),靠 × 按钮区别于"未设置"
                  <span className="prev-season-missing">（已标记「没有上一季」）</span>
                )}
                <button
                  type="button"
                  className="prev-season-remove"
                  onClick={() => void handleClearPrevSeason()}
                  title="移除上一季关联(回到「未设置」状态)"
                >
                  ×
                </button>
              </>
            ) : (
              // 未设置 —— label + +设置按钮
              <button
                type="button"
                className="prev-season-add"
                onClick={() => setSeasonPickerMode('prev')}
                title="主动设置上一季(粘性) / 标记「没有上一季」"
              >
                + 设置上一季
              </button>
            )}
          </div>

          {/* 右侧:下一季 —— 镜像布局(label 在最右,整组靠右) */}
          <div className="next-season">
            {cur.nextSeasonId === undefined || cur.nextSeasonId === '' ? (
              <>
                <button
                  type="button"
                  className="next-season-add"
                  onClick={() => setSeasonPickerMode('next')}
                >
                  + 设置下一季
                </button>
                <span className="next-season-label">下一季</span>
              </>
            ) : nextSeasonBook ? (
              <>
                <button
                  type="button"
                  className="next-season-remove"
                  onClick={() => void handleClearNextSeason()}
                  title="移除下一季关联(回到「未设置」状态)"
                >
                  ×
                </button>
                <span
                  className="next-season-link"
                  onClick={() => select(nextSeasonBook.id)}
                  title="点击跳到该作品"
                >
                  {nextSeasonBook.title}
                </span>
                <span className="next-season-label">下一季</span>
              </>
            ) : (
              // 引用了已被删除的作品 —— 优雅降级
              <>
                <button
                  type="button"
                  className="next-season-remove"
                  onClick={() => void handleClearNextSeason()}
                  title="清除失效的下一季引用"
                >
                  ×
                </button>
                <span className="next-season-missing">
                  原作品已删除 (id: {cur.nextSeasonId})
                </span>
                <span className="next-season-label">下一季</span>
              </>
            )}
          </div>
        </div>
        <NextSeasonPicker
          open={seasonPickerMode !== null}
          onClose={() => setSeasonPickerMode(null)}
          candidates={nextSeasonCandidates}
          onPick={(id) => (seasonPickerMode === 'prev' ? void handleSetPrevSeason(id) : void handleSetNextSeason(id))}
          currentTitle={cur.title}
          mode={seasonPickerMode ?? 'next'}
        />
      </section>

      {/* 「所属系列」关联(v1.7 新增;无序收藏夹分组)—— 放在「下一季」区块之后,
          跟 PrereqEditor 之前;用户核心诉求:"几季 + 衍生作品全部摊开很占空间",
          在这里汇总同系列的其他作品,方便跨作品跳转 */}
      <section className="series-block">
        <h3 className="series-title">所属系列</h3>
        <div className="series">
          <span className="series-label">所属系列:</span>
          {cur.seriesId === undefined || cur.seriesId === '' ? (
            <>
              <span className="series-missing">未设置</span>
              <button
                type="button"
                className="series-add"
                onClick={openSeriesPicker}
              >
                + 设置系列
              </button>
            </>
          ) : currentSeries ? (
            <>
              <span
                className="series-link"
                onClick={() => setSeriesPickerOpen(true)}
                title="点击切换系列"
              >
                {currentSeries.name}
              </span>
              <button
                type="button"
                className="series-remove"
                onClick={() => void handleClearSeries()}
                title="移除所属系列"
              >
                ×
              </button>
            </>
          ) : (
            // 引用了已被删除的系列 —— 优雅降级(同 NextSeasonPicker 同款处理)
            <>
              <span className="series-missing">
                原系列已删除 (id: {cur.seriesId})
              </span>
              <button
                type="button"
                className="series-remove"
                onClick={() => void handleClearSeries()}
                title="清除失效的系列引用"
              >
                × 清除
              </button>
            </>
          )}
        </div>
        {/* 同系列其他作品(去重,排除自己)—— 用户核心诉求的解决方案。
            最多展示 8 本 + 「查看全部」展开;数量小,几十以内(几季 + 衍生)。 */}
        {seriesSiblings.length > 0 && (
          <div className="series-siblings">
            <span className="series-siblings-label">
              同系列还有 {seriesSiblings.length} 本:
            </span>
            <ul className="series-siblings-list">
              {seriesSiblings.slice(0, 8).map((b) => (
                <li
                  key={b.id}
                  className={`kind-${b.kind}`}
                  onClick={() => select(b.id)}
                  title="点击查看详情"
                >
                  <span className={`kind-tag kind-${b.kind}`}>
                    {WORK_KIND_LABELS[b.kind]}
                  </span>
                  <span className="title">{b.title}</span>
                  <span className="tracker-id muted">{b.id}</span>
                </li>
              ))}
            </ul>
            {seriesSiblings.length > 8 && (
              <p className="muted series-siblings-overflow">
                还有 {seriesSiblings.length - 8} 本未展示 —— 在「+ 添加」→「系列」tab 查看全部系列
              </p>
            )}
          </div>
        )}
        <SeriesPickerModal
          open={seriesPickerOpen}
          onClose={() => setSeriesPickerOpen(false)}
          onPick={(id) => void handleSetSeries(id)}
          currentTitle={cur.title}
        />
      </section>

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
