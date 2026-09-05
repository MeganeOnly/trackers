// 加作品表单的纯 form body(v1.8 起)—— 从原 BookForm 抽出。
//
// **为什么抽出来**:AddModal(统一添加 modal,tabs 切换作品/系列)需要复用本表单
// 但不能再嵌一层 Modal(Modal 内嵌 Modal 行为不可控)。所以本组件只负责 <form>,
// Modal 包装由调用方(AddModal)提供。BookForm 不再保留 —— 它原本只被 App.tsx
// 在「+ 加作品」按钮处用,且总是 book=null,本组件等位替代。
//
// **props 变更**:不再接 book prop —— 加作品是唯一入口(详情页走 BookDetail 内联
// 编辑,不再走 BookForm)。需要编辑作品时由后续 PR 决定是否在 AddModal 加新 tab。
// 现在本组件只做「加」一件事,行为/字段/校验完全等同原 BookForm(book=null 路径)。
//
// **共享助手函数保留**:`statusOptionsFor` / `authorLabelFor` / `translatorLabelFor`
// / `starringLabelFor` / `screenwriterLabelFor` / `yearLabelFor` / `countryLabelFor`
// 全部就地保留,这些是 BookForm 内部 helper,改了一致性需连带 BookDetail /
// RankingCompare 同步,留组件内。

import { useEffect, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useSettingsStore } from '../store/settings'
import { WORK_KIND_LABELS, WORK_KIND_ORDER } from '@shared/types'
import type { BookStatus, SeasonInfo, WorkKind } from '@shared/types'

interface BookFormFieldsProps {
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

export function BookFormFields({ onClose }: BookFormFieldsProps): JSX.Element {
  const create = useBooksStore((s) => s.create)
  const defaultWorkKind = useSettingsStore((s) => s.defaultWorkKind)

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<WorkKind>(defaultWorkKind)
  const [author, setAuthor] = useState('')
  const [country, setCountry] = useState('')
  const [year, setYear] = useState<string>('')
  const [translator, setTranslator] = useState('')
  const [status, setStatus] = useState<BookStatus>('want')
  const [readCount, setReadCount] = useState<number>(1)
  // 章节进度（仅 status === 'reading' 时提交到 input）
  const [progressCurrent, setProgressCurrent] = useState<string>('')
  const [progressTotal, setProgressTotal] = useState<string>('')
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [notes, setNotes] = useState<string>('')
  const [starring, setStarring] = useState<string>('')
  const [screenwriter, setScreenwriter] = useState<string>('')
  const [tagsText, setTagsText] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 季设置 —— 仅 tv/anime 用;空时兜底给一个单季 0 集。
  // v1.8 加作品路径无 IPC 实时写盘,全部跟 handleSubmit 一起提交 —— 故不需要
  // 原 BookForm 的 seasonsSaved 提示 + onBlur 实时写盘逻辑。
  const [seasons, setSeasons] = useState<SeasonInfo[]>([{ number: 1, episodeCount: 0 }])
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
    // 加作品路径无 book prop,实时写盘走不通 —— 跟 handleSubmit 一起提交即可
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
  }
  function updateSeasonCount(idx: number, count: number): void {
    const next = [...seasons]
    next[idx] = { ...next[idx], episodeCount: Math.max(0, Math.floor(count) || 0) }
    setSeasons(next)
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
      // 季设置:仅 tv/anime 写入。加作品路径下没有 IPC 实时写盘,全部走 handleSubmit 一并提交
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
      await create(input)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
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
            </span>
          </div>
          {seasons.map((s, idx) => (
            <div className="season-row" key={`${s.number}-${idx}`}>
              <span className="season-label">S{String(s.number).padStart(2, '0')}</span>
              <input
                type="number"
                value={s.episodeCount}
                onChange={(e) => updateSeasonCount(idx, Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                }}
                min="0"
                placeholder="集数"
                title="保存作品时一并提交"
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
            新建作品时季设置随作品一起保存。
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
  )
}