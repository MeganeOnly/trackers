import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { useBooksStore } from '../store/books'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { Book, BookStatus, SeasonInfo, WorkKind } from '@shared/types'

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
  const seasonsSet = useBooksStore((s) => s.setSeasons)
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
  // 「已保存」短提示(失焦实时写盘的反馈);与 BookDetail 同款 1.5s 自动消失
  const [seasonsSaved, setSeasonsSaved] = useState(false)
  const seasonsSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 季设置 —— 仅 tv/anime 用;book?.seasons 为空时兜底用 progress.total 推一个单季
  const [seasons, setSeasons] = useState<SeasonInfo[]>(
    book?.seasons && book.seasons.length > 0
      ? [...book.seasons].sort((a, b) => a.number - b.number)
      : [{ number: 1, episodeCount: book?.progress?.total ?? 0 }]
  )
  // tv/anime 切换时若 seasons 为空,自动给一个单季 0 集
  useEffect(() => {
    if (kind === 'tv' || kind === 'anime') {
      if (seasons.length === 0) {
        setSeasons([{ number: 1, episodeCount: 0 }])
      }
    } else {
      // 非 tv/anime 强制清空季设置(虽然 UI 已经不显示了,但 state 还留着)
      if (seasons.length > 0) setSeasons([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  function addSeason(): void {
    const nextNumber =
      seasons.length === 0 ? 1 : Math.max(...seasons.map((s) => s.number)) + 1
    const next = [...seasons, { number: nextNumber, episodeCount: 0 }]
    setSeasons(next)
    // 编辑模式下实时写盘(与 onBlur 同款);新建模式下不写(create 时一并提交)
    if (book) {
      void seasonsSet(book.id, next).then(() => flashSeasonsSaved())
    }
  }
  function removeSeason(idx: number): void {
    let next: SeasonInfo[]
    if (seasons.length <= 1) {
      // 至少留一季(用户主动删完就只剩空季也允许,但 UI 上空季没意义 —— 强制删季时若只有 1 季,改其集数为 0)
      next = [...seasons]
      next[idx] = { ...next[idx], episodeCount: 0 }
    } else {
      next = seasons.filter((_, i) => i !== idx)
    }
    setSeasons(next)
    // 编辑模式下实时写盘
    if (book) {
      void seasonsSet(book.id, next).then(() => flashSeasonsSaved())
    }
  }
  function updateSeasonCount(idx: number, count: number): void {
    const next = [...seasons]
    next[idx] = { ...next[idx], episodeCount: Math.max(0, Math.floor(count) || 0) }
    setSeasons(next)
  }

  /**
   * 「季设置已保存」短提示触发器 —— 1.5s 自动消失(同 BookDetail 的 `saved` 反馈)。
   * 抽出来共享给 flushSeason / addSeason / removeSeason 三处,避免重复 timer 清理逻辑。
   */
  function flashSeasonsSaved(): void {
    setSeasonsSaved(true)
    if (seasonsSavedTimerRef.current) clearTimeout(seasonsSavedTimerRef.current)
    seasonsSavedTimerRef.current = setTimeout(() => setSeasonsSaved(false), 1500)
  }

  /**
   * 季设置失焦实时写盘(v1.6 起)—— 与 EpisodesPanel 的"X 集"input 同款语义:
   * 改完失焦 / 回车就调 setSeasons IPC,不等底部"保存"按钮,避免用户在改数字的中间
   * (清空 / 临时值)被切走 / 关闭弹窗时丢失修改。
   *
   * 只有"实际值有变化"才发(避免冗余 IPC);只有编辑已有 book 时才有 book prop,
   * 新建作品(this.book === null)不调 IPC,等 handleSubmit 走 create 时一并提交。
   */
  function flushSeason(idx: number): void {
    if (!book) return
    const target = seasons[idx]
    if (!target) return
    // 与已持久化的 seasons 对比,无变化不写
    const persisted = book.seasons && book.seasons.length > 0 ? book.seasons : []
    const persistedEpisodeCount = persisted.find((s) => s.number === target.number)?.episodeCount
    if (persistedEpisodeCount === target.episodeCount) return
    // 整段替换 seasons(只改当前季的 episodeCount,其他季不动)
    const next = seasons.map((s) =>
      s.number === target.number ? { ...s, episodeCount: target.episodeCount } : s
    )
    void seasonsSet(book.id, next).then(() => flashSeasonsSaved())
  }

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
      // 季设置:仅 tv/anime 写入。
      // **编辑模式**下季设置已通过 input onBlur 实时写盘(setSeasons IPC),但**用户可能
      // 改了 input 没失焦就点保存**(没触发 onBlur),所以 handleSubmit 也要兜底带
      // patch.seasons —— 以本地 React state 为准(stripSeasonsFromStateForPatch 过滤空季)。
      // 与 onBlur 实时写盘不冲突:两者都写同一个值(都是本地 state),React 18 自动 batch。
      // **新建模式**下(book === null)需要把 seasons 写进 input 走 create。
      if (kind === 'tv' || kind === 'anime') {
        const validSeasons = seasons.filter((s) => s.episodeCount > 0 || seasons.length === 1)
        if (validSeasons.length > 0) {
          input.seasons = validSeasons
          // tv/anime 时 progress.total 跟 seasons 总和保持同步(避免出现 5 季但 total 还是 10 的错位)
          if (input.progress) {
            input.progress = {
              ...input.progress,
              total: validSeasons.reduce((sum, s) => sum + s.episodeCount, 0)
            }
          }
        }
      }
      if (isEdit && book) {
        const patch: Parameters<typeof update>[1] = { ...input, read_count: readCount }
        // 编辑模式下,如果 status 不是「进行中」,主动清空 progress（用户主动清除意图）
        if (status !== 'reading' && status !== 'watching') patch.progress = null
        // 编辑模式下 kind 不是 tv/anime 时主动 delete patch.seasons(保持现状,
        // 清掉老 seasons 字段);tv/anime 保留 input.seasons 作为兜底(以防用户改了
        // input 没失焦就点保存 —— onBlur 实时写盘未触发)。
        if (!(kind === 'tv' || kind === 'anime')) {
          delete (patch as { seasons?: unknown }).seasons
        }
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
        {(kind === 'tv' || kind === 'anime') && (
          <div className="seasons-editor">
            <div className="seasons-editor-head">
              <span>季设置</span>
              <span className="muted">
                总集数 = {seasons.reduce((sum, s) => sum + s.episodeCount, 0)}
                {seasonsSaved && book && (
                  <span className="seasons-saved-tag" style={{ marginLeft: '8px' }}>
                    · 季设置已保存
                  </span>
                )}
              </span>
            </div>
            {seasons.map((s, idx) => (
              <div className="season-row" key={`${s.number}-${idx}`}>
                <span className="season-label">S{String(s.number).padStart(2, '0')}</span>
                <input
                  type="number"
                  value={s.episodeCount}
                  onChange={(e) => updateSeasonCount(idx, Number(e.target.value))}
                  onBlur={() => flushSeason(idx)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  min="0"
                  placeholder="集数"
                  title={book ? '失焦或回车自动保存' : '保存作品时一并提交'}
                />
                <span className="season-unit">集</span>
                <button
                  type="button"
                  className="season-remove"
                  onClick={() => removeSeason(idx)}
                  disabled={seasons.length === 1}
                  title={seasons.length === 1 ? '至少保留 1 季(改为 0 集)' : '删除这一季'}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="season-add" onClick={addSeason}>
              + 新增一季
            </button>
            <p className="muted seasons-hint">
              单集笔记 / 标题在详情页编辑;季数中途变化时旧的集笔记保留(用户手填即可)。
              {book
                ? '编辑模式下改完失焦或回车自动保存,不需要点底部"保存"按钮。'
                : '新建作品时季设置随作品一起保存。'}
            </p>
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
