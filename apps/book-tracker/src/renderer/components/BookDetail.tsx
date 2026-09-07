// 编辑模式右侧的书详情 = 内联可编辑表单：
// - 所有字段直接可编辑，点「保存」统一写盘，不再需要额外的「编辑」弹窗
// - 无章节进度（progress === null）时只显示读完/没读完，不显示章节进度条
// - 前置依赖编辑器与进度快捷调整（-1/+1/+5/读完）保留在下方
//
// 拆分(svg-2026-09, 响应 DSH 插件 700 行/30KB 阈值):
// - BookDetail.labels.ts   状态 / 作品类型 标签纯函数
// - BookDetailFields.tsx   字段行渲染(原 detail-form 段落)
// - BookDetailSeasons.tsx  「上一季 / 下一季」组合块
// - BookDetailSeries.tsx   「所属系列」关联 + 同系列其他作品
// 本文件保留: 组件本体 + 状态编排 + 季节 / 系列区块以外的渲染

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useBooksStore } from '../store/books'
import { useUnlocked } from '../store/selectors'
import { PrereqEditor } from './PrereqEditor'
import { EpisodesPanel } from './EpisodesPanel'
import { CharactersPanel } from './CharactersPanel'
import { BookStampsPanel } from './BookStampsPanel'
import { useSeriesStore } from '../store/series'
import { useWikilinkTextarea } from './useWikilinkTextarea'
import { progressPercent } from '@core'
import { formatProgress } from '@shared/progress'
import { StampChip } from '@ui/StampChip'
import { STATUS_LABELS } from './BookDetail.labels'
import type { BookInput, BookStatus, WorkKind } from '@shared/types'
import { BookDetailFields } from './BookDetailFields'
import { BookDetailSeasons } from './BookDetailSeasons'
import { BookDetailSeries } from './BookDetailSeries'

interface BookDetailProps {
  /** 显式指定显示哪本书；不传则用全局 selectedId */
  bookId?: string
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
  // v2.x 顶层 stamps action —— 走专用 IPC(目前仅 movie 实际使用)
  const setStamps = useBooksStore((s) => s.setStamps)
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
  // 笔记 textarea Esc 也切回预览(避免用户点 textarea 外部只能依赖鼠标 blur)
  const handleNotesKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setNoteEditing(false)
        ;(e.currentTarget as HTMLTextAreaElement).blur()
      }
    },
    []
  )

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

      <BookDetailFields
        book={cur}
        kind={kind}
        year={year}
        author={author}
        translator={translator}
        country={country}
        status={status}
        readCount={readCount}
        starring={starring}
        screenwriter={screenwriter}
        tagsText={tagsText}
        collapsed={collapsed}
        notes={notes}
        noteEditing={noteEditing}
        editingField={editingField}
        error={error}
        allBooks={books}
        setKind={setKind}
        setYear={setYear}
        setAuthor={setAuthor}
        setTranslator={setTranslator}
        setCountry={setCountry}
        setStatus={setStatus}
        setReadCount={setReadCount}
        setStarring={setStarring}
        setScreenwriter={setScreenwriter}
        setTagsText={setTagsText}
        setCollapsed={setCollapsed}
        setNoteEditing={setNoteEditing}
        setEditingField={setEditingField}
        notesTaRef={notesTaRef}
        handleNotesChange={handleNotesChange}
        onNotesKeyDown={handleNotesKeyDown}
      />

      {/* 集笔记 —— 仅 tv/anime 显示,放在前置依赖之前(用户最关心的进度信息) */}
      {(kind === 'tv' || kind === 'anime') && <EpisodesPanel book={cur} />}

      {/* 顶层时间戳笔记 —— 目前仅 movie 实际使用(v2.x 新增);放在 EpisodesPanel 之后,CharactersPanel 之前
          (跟「剧集笔记 / 章节笔记」属于同一类「分场景笔记」聚合)。book / other 暂不在 UI 暴露。
          改 stamps 走专用 IPC `books_set_stamps`,不刷 book.updated(沿用 EpisodeRecord.stamps 同款语义) */}
      {kind === 'movie' && (
        <BookStampsPanel
          book={cur}
          allBooks={books}
          stamps={cur.stamps}
          onChange={(s) => setStamps(cur.id, s)}
        />
      )}

      {/* 角色笔记 —— 所有类型都能用(v1.5 起);在集笔记 / detail-form 之后,前置依赖之前 */}
      <CharactersPanel book={cur} />

      <BookDetailSeasons
        book={cur}
        prevSeasonBook={prevSeasonBook}
        nextSeasonBook={nextSeasonBook}
        nextSeasonCandidates={nextSeasonCandidates}
        seasonPickerMode={seasonPickerMode}
        onSelectBook={select}
        onSetSeasonPickerMode={setSeasonPickerMode}
        onSetPrevSeason={handleSetPrevSeason}
        onSetNextSeason={handleSetNextSeason}
        onClearPrevSeason={handleClearPrevSeason}
        onClearNextSeason={handleClearNextSeason}
      />

      <BookDetailSeries
        book={cur}
        currentSeries={currentSeries}
        seriesSiblings={seriesSiblings}
        seriesPickerOpen={seriesPickerOpen}
        onOpenSeriesPicker={openSeriesPicker}
        onCloseSeriesPicker={() => setSeriesPickerOpen(false)}
        onSetSeries={handleSetSeries}
        onClearSeries={handleClearSeries}
        onSelectBook={select}
      />

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
