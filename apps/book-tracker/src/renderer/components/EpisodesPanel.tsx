// 集笔记面板 —— BookDetail 的「集笔记」区块
//
// 仅当 book.kind === 'tv' | 'anime' 时渲染(由 BookDetail 决定是否引入)。
// 职责:
// - 季选择器(tab 式 + 「上一季 / 下一季」按钮)
// - 当前季的集网格(点击格子展开 / 双击切换 watched)
// - 展开区:标题输入 / watched toggle / 笔记 textarea / 时间戳笔记 stamps / 删除按钮
// - 顶部操作栏:已看统计 / +1 / -1 / 清空
//
// 状态:
// - selectedSeason: 当前选中的季号(默认 = 第一个未完全看完的季;全看完则最后一个季)
// - expandedEpisode: 当前展开的集号(单选,互斥)
// - 笔记/标题本地 draft:失焦 / debounce 500ms 写盘
// - 时间戳笔记:本地即时态(无 debounce),按 start 升序自动排列,逐条 add/edit/delete 都整体回写
//
// 数据:
// - 季信息 / 集笔记通过 selectors 取(useSeasonsForBook / useEpisodesForBook / useEpisodeStats)
// - 所有变更走 store action(setEpisode* / episodeBump / clearEpisodes / setSeasons / setEpisodeStamps)

import { useEffect, useMemo, useRef, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useEpisodeStats, useEpisodesForBook, useSeasonsForBook } from '../store/selectors'
import { episodeKey, formatStamp, parseEpisodeKey, parseStamp, sortStamps } from '@shared/types'
import type { Book, TimeStamp } from '@shared/types'

interface EpisodesPanelProps {
  book: Book
}

const DEBOUNCE_MS = 500

export function EpisodesPanel({ book }: EpisodesPanelProps): JSX.Element {
  const seasons = useSeasonsForBook(book.id)
  const episodes = useEpisodesForBook(book.id)
  const stats = useEpisodeStats(book.id)
  const setEpisodeWatched = useBooksStore((s) => s.setEpisodeWatched)
  const setEpisodeNote = useBooksStore((s) => s.setEpisodeNote)
  const setEpisodeTitle = useBooksStore((s) => s.setEpisodeTitle)
  const setEpisodeStamps = useBooksStore((s) => s.setEpisodeStamps)
  const episodeBump = useBooksStore((s) => s.episodeBump)
  const clearEpisodes = useBooksStore((s) => s.clearEpisodes)

  // 选中的季号:默认 = 第一个未完全看完的季;全看完则最后一个季;无季时 = 1
  const [selectedSeason, setSelectedSeason] = useState<number>(() => initialSeason(seasons, episodes))
  // book.id 切换时重置季选择 / 展开
  useEffect(() => {
    setSelectedSeason(initialSeason(seasons, episodes))
    setExpandedEpisode(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])
  // 当前季变了 → 收起展开的格子
  useEffect(() => {
    setExpandedEpisode(null)
  }, [selectedSeason])

  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null)

  // 当前季的元信息
  const currentSeason = useMemo(
    () => seasons.find((s) => s.number === selectedSeason) ?? seasons[0],
    [seasons, selectedSeason]
  )

  async function handleBump(delta: number): Promise<void> {
    await episodeBump(book.id, delta)
  }

  async function handleClear(): Promise<void> {
    if (!confirm(`清空《${book.title}》所有集笔记?进度数字会保留,但所有 watched / 笔记 / 标题都会删除。`)) return
    await clearEpisodes(book.id)
    setExpandedEpisode(null)
  }

  if (!currentSeason) {
    return (
      <section className="episodes-panel">
        <h3 className="episodes-panel-title">集笔记</h3>
        <p className="muted">这部作品暂无季信息 —— 在编辑表单里加季后才能记录单集笔记。</p>
      </section>
    )
  }

  const seasonEps = collectSeasonEpisodes(currentSeason.number, currentSeason.episodeCount, episodes)
  const watchedThisSeason = seasonEps.filter((e) => e.record?.watched).length

  return (
    <section className="episodes-panel">
      <h3 className="episodes-panel-title">集笔记</h3>
      {/* 顶部统计 + 快速操作 */}
      <div className="episodes-stats">
        <span>
          已看 <b>{stats.watchedCount}</b> / {stats.totalEpisodes || '?'}
        </span>
        <span className="dot">·</span>
        <span>
          {stats.noteCount} 条笔记
        </span>
        <div className="episodes-actions">
          <button className="btn-secondary" onClick={() => void handleBump(-1)} disabled={!book.progress}>
            -1 集
          </button>
          <button className="btn-secondary" onClick={() => void handleBump(+1)}>
            +1 集
          </button>
          <button className="btn-secondary episodes-clear" onClick={() => void handleClear()}>
            清空
          </button>
        </div>
      </div>

      {/* 季选择器:tab + 上一季/下一季 按钮(用户要求) */}
      <div className="seasons-tabs">
        <button
          className="season-nav"
          onClick={() => setSelectedSeason(Math.max(1, selectedSeason - 1))}
          disabled={selectedSeason <= 1}
          title="上一季"
        >
          ◀
        </button>
        <div className="seasons-tabs-list">
          {seasons.map((s) => {
            const seasonWatched = countWatchedInSeason(s.number, s.episodeCount, episodes)
            const isCurrent = s.number === selectedSeason
            return (
              <button
                key={s.number}
                className={`season-tab${isCurrent ? ' active' : ''}`}
                onClick={() => setSelectedSeason(s.number)}
                title={`S${pad2(s.number)} · ${seasonWatched}/${s.episodeCount}`}
              >
                S{pad2(s.number)}
              </button>
            )
          })}
        </div>
        <button
          className="season-nav"
          onClick={() => setSelectedSeason(Math.min(maxSeason(seasons), selectedSeason + 1))}
          disabled={selectedSeason >= maxSeason(seasons)}
          title="下一季"
        >
          ▶
        </button>
      </div>

      {/* 当前季标题 + 进度 */}
      <div className="season-summary">
        <span>
          S{pad2(currentSeason.number)} · {currentSeason.episodeCount} 集 · 已看 {watchedThisSeason}/{currentSeason.episodeCount}
        </span>
      </div>

      {/* 集网格 */}
      <div className="episodes-grid">
        {seasonEps.map(({ episode, record }) => (
          <EpisodeCell
            key={episode}
            season={currentSeason.number}
            episode={episode}
            record={record}
            expanded={expandedEpisode === episode}
            onClick={() => setExpandedEpisode(expandedEpisode === episode ? null : episode)}
            onToggleWatched={() => {
              void setEpisodeWatched(book.id, currentSeason.number, episode, !(record?.watched ?? false))
            }}
          />
        ))}
      </div>

      {/* 展开区(单格) */}
      {expandedEpisode !== null && (
        <EpisodeEditor
          book={book}
          season={currentSeason.number}
          episode={expandedEpisode}
          record={episodes[episodeKey(currentSeason.number, expandedEpisode)]}
          onClose={() => setExpandedEpisode(null)}
          onSetWatched={(w) => void setEpisodeWatched(book.id, currentSeason.number, expandedEpisode, w)}
          onSetNote={(note) => void setEpisodeNote(book.id, currentSeason.number, expandedEpisode, note)}
          onSetTitle={(title) => void setEpisodeTitle(book.id, currentSeason.number, expandedEpisode, title)}
          onSetStamps={(stamps) => void setEpisodeStamps(book.id, currentSeason.number, expandedEpisode, stamps)}
        />
      )}
    </section>
  )
}

// ==================== 子组件:EpisodeCell ====================

interface EpisodeCellProps {
  season: number
  episode: number
  record: import('@shared/types').EpisodeRecord | undefined
  expanded: boolean
  onClick: () => void
  onToggleWatched: () => void
}

function EpisodeCell({
  season,
  episode,
  record,
  expanded,
  onClick,
  onToggleWatched
}: EpisodeCellProps): JSX.Element {
  const watched = record?.watched ?? false
  const hasNote = !!record?.note?.trim()
  const hasTitle = !!record?.title?.trim()
  return (
    <div
      className={`episode-cell${watched ? ' watched' : ''}${hasNote ? ' has-note' : ''}${expanded ? ' expanded' : ''}`}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.preventDefault()
        onToggleWatched()
      }}
      title={`S${pad2(season)}E${pad2(episode)}${hasTitle ? ` · ${record!.title}` : ''}\n单击展开 / 双击标记 watched`}
    >
      <span className="episode-cell-num">{episode}</span>
      {watched && <span className="episode-cell-tick">✓</span>}
      {hasNote && <span className="episode-cell-note-mark">📝</span>}
    </div>
  )
}

// ==================== 子组件:EpisodeEditor ====================

interface EpisodeEditorProps {
  book: Book
  season: number
  episode: number
  record: import('@shared/types').EpisodeRecord | undefined
  onClose: () => void
  onSetWatched: (watched: boolean) => void
  onSetNote: (note: string) => void
  onSetTitle: (title: string) => void
  /**
   * 整体回写时间戳笔记数组(v1.3 新增)。
   * 父组件不再持有 stamps 草稿态 —— stamps 是"短输入多操作"的形态
   * (每条 1-2 个时间字段 + 1 个 note),用数组替换式回写更简单,
   * 父组件提供 onSetStamps 时 stamps 已按 start 升序排好。
   */
  onSetStamps: (stamps: TimeStamp[]) => void
}

function EpisodeEditor({
  book,
  season,
  episode,
  record,
  onClose,
  onSetWatched,
  onSetNote,
  onSetTitle,
  onSetStamps
}: EpisodeEditorProps): JSX.Element {
  // 本地 draft —— 失焦 / debounce 后再写 store,避免边敲边发 IPC
  const [titleDraft, setTitleDraft] = useState<string>(record?.title ?? '')
  const [noteDraft, setNoteDraft] = useState<string>(record?.note ?? '')
  const watched = record?.watched ?? false
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // record 变化(外部 store 更新)→ 同步本地 draft(避免覆盖用户正在敲的内容)
  useEffect(() => {
    setTitleDraft(record?.title ?? '')
  }, [record?.title])
  useEffect(() => {
    setNoteDraft(record?.note ?? '')
  }, [record?.note])

  function flushTitle(): void {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    const trimmed = titleDraft.trim()
    // 空串 → 删 title 字段(由 service 兜底,这里就传原始 draft 即可)
    onSetTitle(titleDraft)
  }
  function flushNote(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    onSetNote(noteDraft)
  }
  function scheduleTitleFlush(): void {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(flushTitle, DEBOUNCE_MS)
  }
  function scheduleNoteFlush(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(flushNote, DEBOUNCE_MS)
  }

  return (
    <div className="episode-editor">
      <div className="episode-editor-head">
        <span>
          S{pad2(season)} E{pad2(episode)}
        </span>
        <button type="button" className="episode-editor-close" onClick={onClose}>
          ×
        </button>
      </div>
      <label className="field">
        <span>标题(可选,如"改稻为桑")</span>
        <input
          value={titleDraft}
          onChange={(e) => {
            setTitleDraft(e.target.value)
            scheduleTitleFlush()
          }}
          onBlur={flushTitle}
          placeholder="集标题"
        />
      </label>
      <label className="form-checkline">
        <input type="checkbox" checked={watched} onChange={(e) => onSetWatched(e.target.checked)} />
        <span>已看</span>
      </label>
      <label className="field">
        <span>笔记</span>
        <textarea
          value={noteDraft}
          onChange={(e) => {
            setNoteDraft(e.target.value)
            scheduleNoteFlush()
          }}
          onBlur={flushNote}
          rows={5}
          placeholder="自由写 —— 心得 / 摘录 / 备忘(空串 = 删除此集记录)"
        />
      </label>
      {/* v1.3 时间戳笔记 —— 按 start 升序自动排列,逐条 add/edit/delete 都整体回写 */}
      <StampList
        stamps={record?.stamps ?? []}
        onChange={onSetStamps}
      />
      <div className="episode-editor-foot">
        <button
          type="button"
          className="btn-danger episode-delete"
          onClick={() => {
            if (!confirm(`删除 S${pad2(season)}E${pad2(episode)} 的所有记录(watched / 笔记 / 标题 / 时间戳)?`)) return
            // 四步清零:watched=false → 空 note → 空 title → 空 stamps(后三步空串/空数组会触发 service 删 key)
            onSetWatched(false)
            onSetNote('')
            onSetTitle('')
            onSetStamps([])
            onClose()
          }}
        >
          删除此集记录
        </button>
        <span className="muted">
          提示:单击格子展开 / 双击格子快速切换 watched
        </span>
      </div>
      {/* 故意留个空注释占位避免 lint */}
      <span style={{ display: 'none' }}>{book.title}</span>
    </div>
  )
}

// ==================== 子组件:StampList (v1.3 时间戳笔记) ====================

interface StampListProps {
  stamps: TimeStamp[]
  onChange: (stamps: TimeStamp[]) => void
}

/**
 * 时间戳笔记区块 —— 用户输入一行"开始 → 结束 → 笔记"作为一条 stamp,点 + 添加。
 *
 * 设计要点:
 * - **无 debounce**:stamp 输入短,提交即写盘;debounce 反而让用户对"已保存"反馈模糊
 * - **整体回写**:不再做单条 IPC(避免并发冲突);每次 add/edit/delete 都构造新数组
 * - **自动排序**:写盘前 `sortStamps` 按 start 升序;显示列表也是已排序的
 * - **单时间点 vs 时间段**:end 留空 = 单时间点(时刻),end 填了 = 时间段(片段)
 * - **id 用 `crypto.randomUUID()`**:稳定 UUID,让 edit/delete 能精确锁定单条
 */
function StampList({ stamps, onChange }: StampListProps): JSX.Element {
  // 已排序的展示列表 —— 每次 props.stamps 变化重排(防止外部不按序传入)
  const sortedStamps = useMemo(() => sortStamps(stamps), [stamps])

  // 三段输入:开始时间 / 结束时间(可选) / 笔记
  const [startInput, setStartInput] = useState<string>('')
  const [endInput, setEndInput] = useState<string>('')
  const [noteInput, setNoteInput] = useState<string>('')
  // 输入校验错误提示;空 = 无错误
  const [inputError, setInputError] = useState<string>('')

  function handleAdd(): void {
    setInputError('')
    const startTrimmed = startInput.trim()
    const noteTrimmed = noteInput.trim()
    // 校验 1:开始时间必填且能解析
    if (startTrimmed === '') {
      setInputError('请输入开始时间')
      return
    }
    const startSec = parseStamp(startTrimmed)
    if (startSec === null) {
      setInputError(`开始时间格式错误:"${startTrimmed}"(支持 ss / mm:ss / hh:mm:ss)`)
      return
    }
    // 校验 2:结束时间(可选)能解析
    const endTrimmed = endInput.trim()
    let endSec: number | undefined = undefined
    if (endTrimmed !== '') {
      const parsed = parseStamp(endTrimmed)
      if (parsed === null) {
        setInputError(`结束时间格式错误:"${endTrimmed}"`)
        return
      }
      endSec = parsed
    }
    // 校验 3:end >= start(若给了 end)
    if (endSec !== undefined && endSec < startSec) {
      setInputError('结束时间不能早于开始时间')
      return
    }
    const newStamp: TimeStamp = {
      id: makeStampId(),
      start: startSec,
      end: endSec,
      note: noteTrimmed
    }
    onChange(sortStamps([...sortedStamps, newStamp]))
    // 清空输入(让用户看清"已添加");焦点自然回落到第一个 input
    setStartInput('')
    setEndInput('')
    setNoteInput('')
  }

  function handleDelete(id: string): void {
    onChange(sortStamps(sortedStamps.filter((s) => s.id !== id)))
  }

  function handleEditStart(id: string, raw: string): void {
    const parsed = parseStamp(raw)
    if (parsed === null) return // 解析失败静默不写(避免覆盖合法数据);用户撤销 / 重新输入
    onChange(sortStamps(sortedStamps.map((s) => (s.id === id ? { ...s, start: parsed } : s))))
  }

  function handleEditEnd(id: string, raw: string): void {
    const trimmed = raw.trim()
    if (trimmed === '') {
      // 空串 → 清除 end(回到单时间点)
      onChange(sortStamps(sortedStamps.map((s) => (s.id === id ? { ...s, end: undefined } : s))))
      return
    }
    const parsed = parseStamp(trimmed)
    if (parsed === null) return
    onChange(sortStamps(sortedStamps.map((s) => (s.id === id ? { ...s, end: parsed } : s))))
  }

  function handleEditNote(id: string, raw: string): void {
    onChange(sortStamps(sortedStamps.map((s) => (s.id === id ? { ...s, note: raw } : s))))
  }

  return (
    <div className="stamp-list">
      <div className="stamp-list-head">
        <span>时间戳笔记</span>
        <span className="stamp-list-count">{sortedStamps.length} 条</span>
      </div>
      {/* 已存在的 stamp —— 按 start 升序展示 */}
      {sortedStamps.length > 0 && (
        <ul className="stamp-list-items">
          {sortedStamps.map((s) => (
            <li key={s.id} className="stamp-row">
              <span className="stamp-row-time">
                {formatStamp(s.start)}
                {s.end !== undefined && (
                  <>
                    {' → '}
                    {formatStamp(s.end)}
                  </>
                )}
              </span>
              <input
                className="stamp-row-note"
                value={s.note}
                onChange={(e) => handleEditNote(s.id, e.target.value)}
                placeholder="(无笔记)"
              />
              <button
                type="button"
                className="stamp-row-del"
                onClick={() => handleDelete(s.id)}
                title="删除这条时间戳"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* 添加区:开始 / 结束(可选) / 笔记 / + */}
      <div className="stamp-add">
        <input
          className="stamp-add-time"
          value={startInput}
          onChange={(e) => setStartInput(e.target.value)}
          placeholder="开始 mm:ss"
          aria-label="开始时间"
        />
        <span className="stamp-add-sep">→</span>
        <input
          className="stamp-add-time"
          value={endInput}
          onChange={(e) => setEndInput(e.target.value)}
          placeholder="结束(可选)"
          aria-label="结束时间"
        />
        <input
          className="stamp-add-note"
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          placeholder="这一段讲什么"
          onKeyDown={(e) => {
            // Enter 直接添加(Ctrl+Enter 留给多行?当前单行所以 Enter 就提交)
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
        />
        <button type="button" className="stamp-add-btn" onClick={handleAdd} title="添加时间戳">
          +
        </button>
      </div>
      {inputError && <div className="stamp-add-error">{inputError}</div>}
      <p className="stamp-list-hint muted">
        时间格式支持 <code>ss</code> / <code>mm:ss</code> / <code>hh:mm:ss</code>;留空结束 = 单时间点(标记"这一刻")
      </p>
    </div>
  )
}

/** 生成稳定 UUID;优先 `crypto.randomUUID()`(浏览器原生),降级到时间戳 + 随机数。 */
function makeStampId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 降级方案:时间戳 + 4 位随机十六进制(同 id 概率极低,够用)
  return `stamp-${Date.now()}-${Math.floor(Math.random() * 0x10000).toString(16)}`
}

// ==================== 工具函数 ====================

/** 默认选中的季号:第一个未完全看完的季;全看完 = 最后一季。 */
function initialSeason(
  seasons: ReadonlyArray<{ number: number; episodeCount: number }>,
  episodes: Record<string, { watched: boolean }>
): number {
  if (seasons.length === 0) return 1
  for (const s of seasons) {
    if (countWatchedInSeason(s.number, s.episodeCount, episodes) < s.episodeCount) return s.number
  }
  return seasons[seasons.length - 1].number
}

function countWatchedInSeason(
  season: number,
  count: number,
  episodes: Record<string, { watched: boolean }>
): number {
  let n = 0
  for (let e = 1; e <= count; e++) {
    if (episodes[episodeKey(season, e)]?.watched) n++
  }
  return n
}

function collectSeasonEpisodes(
  season: number,
  count: number,
  episodes: Record<string, import('@shared/types').EpisodeRecord>
): Array<{ episode: number; record: import('@shared/types').EpisodeRecord | undefined }> {
  const list: Array<{ episode: number; record: import('@shared/types').EpisodeRecord | undefined }> = []
  for (let e = 1; e <= count; e++) {
    list.push({ episode: e, record: episodes[episodeKey(season, e)] })
  }
  return list
}

function maxSeason(seasons: ReadonlyArray<{ number: number }>): number {
  if (seasons.length === 0) return 1
  return Math.max(...seasons.map((s) => s.number))
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 防止 lint:确保 parseEpisodeKey 用到(未来批量操作可能用得上)
void parseEpisodeKey
