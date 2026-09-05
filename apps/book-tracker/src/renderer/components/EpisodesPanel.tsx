// 集笔记面板 —— BookDetail 的「集笔记」区块
//
// 仅当 book.kind === 'tv' | 'anime' 时渲染(由 BookDetail 决定是否引入)。
// 职责(v1.6 简化):
// - 当前唯一季的集网格(点击格子展开 / 双击切换 watched)
//   —— **v1.6 起不再有季选择器 tabs**:用户约定"不同季用 nextSeasonId 串成多个 book",
//   每本 book 只追踪一季;季切换 UI 已删,改用 BookDetail「上一季 / 下一季」区块跳转。
//   季结构(seasons[])仍保留 —— 一本书可能因历史遗留 / 误填仍有多个 seasons,
//   这里取 `seasons[0]` 显示(简化逻辑,不再维护 selectedSeason 状态)。
// - 展开区:标题输入 / watched toggle / 笔记 textarea / 时间戳笔记 stamps / 删除按钮
// - 顶部操作栏:已看统计 / +1 / -1 / 清空
// - 季标题里"X 集"是 inline 可编辑 input:用户就地改单季集数,失焦写盘
//
// 状态:
// - expandedEpisode: 当前展开的集号(单选,互斥)
// - 笔记/标题本地 draft:失焦 / debounce 500ms 写盘
// - 时间戳笔记:本地即时态(无 debounce),按 start 升序自动排列,逐条 add/edit/delete 都整体回写
// - 季集数本地 draft:失焦 / Enter 写盘,避免每输入一位就触发 IPC
//
// 数据:
// - 季信息 / 集笔记通过 selectors 取(useSeasonsForBook / useEpisodesForBook / useEpisodeStats)
// - 所有变更走 store action(setEpisode* / episodeBump / clearEpisodes / setSeasons / setEpisodeStamps)
//
// 季结构编辑(v1.4 保留 v1.6 部分):
// - 「X 集」inline input:仅改当前季的 episodeCount,其他季不动
// - 「删除此季」按钮:整段 setSeasons 过滤掉当前季;保留旧 episodes key 不清理(决策 B)
// - **v1.6 移除 「+ 季」按钮 + tabs 切换**:用户加新季的路径改为"新建一本 book + 设下一季"。
// - 同步策略:**不**联动改 book.progress.total / progress.current;理由见 AGENTS.md §十.24

import { useEffect, useMemo, useRef, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useEpisodeStats, useEpisodesForBook, useSeasonsForBook } from '../store/selectors'
import { episodeKey, formatLastModified, formatStamp, parseEpisodeKey, parseStamp, sortStamps } from '@shared/types'
import type { Book, TimeStamp } from '@shared/types'
import { WikilinkText } from './WikilinkText'
import { useWikilinkTextarea } from './useWikilinkTextarea'

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
  // v1.4 季结构就地编辑 —— 整段替换 seasons(v1.6 起只用于"X 集"inline + 删除此季,
  // 不再有「+ 季」和季切换 —— 加新季走"新建 book + 设下一季"路径)
  const setSeasons = useBooksStore((s) => s.setSeasons)

  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null)

  // book.id 切换时收起展开的格子(v1.6 简化:不再有 selectedSeason state)
  useEffect(() => {
    setExpandedEpisode(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // 当前季的元信息 —— v1.6 简化:不再维护 selectedSeason 状态,直接取 seasons[0]
  // (用户约定不同季用 nextSeasonId 串成多本 book,每本只追踪一季;若某本 book 历史
  // 遗留多季,这里只显示 seasons[0];仍保留 seasons[] 以便"X 集"和"删除此季"还能用)
  const currentSeason = useMemo(
    () => seasons[0] ?? null,
    [seasons]
  )

  async function handleBump(delta: number): Promise<void> {
    await episodeBump(book.id, delta)
  }

  async function handleClear(): Promise<void> {
    if (!confirm(`清空《${book.title}》所有集笔记?进度数字会保留,但所有 watched / 笔记 / 标题都会删除。`)) return
    await clearEpisodes(book.id)
    setExpandedEpisode(null)
  }

  // v1.4 季结构就地编辑 —— v1.6 起只剩"X 集"和"删除此季"(无 "+ 季" / 切换季)
  // ---- 单季集数 draft state + flush ----
  const [countDraft, setCountDraft] = useState<string>(() => String(currentSeason?.episodeCount ?? 0))
  // currentSeason 变化 → 同步本地 draft(避免覆盖用户正在敲的内容)
  useEffect(() => {
    setCountDraft(String(currentSeason?.episodeCount ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeason?.number, currentSeason?.episodeCount])
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function flushSeasonCount(): void {
    if (countTimerRef.current) clearTimeout(countTimerRef.current)
    if (!currentSeason) return
    const raw = countDraft.trim()
    if (raw === '') {
      // 空串 → 还原显示,不写盘(避免误清零)
      setCountDraft(String(currentSeason.episodeCount))
      return
    }
    const n = Math.floor(Number(raw))
    if (!Number.isFinite(n) || n < 0) {
      setCountDraft(String(currentSeason.episodeCount))
      return
    }
    if (n === currentSeason.episodeCount) return
    // 整段替换 seasons(只改当前季的 episodeCount,其他季不动)
    const next = seasons.map((s) =>
      s.number === currentSeason.number ? { ...s, episodeCount: n } : s
    )
    void setSeasons(book.id, next).then(() => {
      // 写盘成功后同步 draft(避免 store 更新触发 useEffect 时拿到旧值)
      setCountDraft(String(n))
    })
  }
  function scheduleCountFlush(): void {
    if (countTimerRef.current) clearTimeout(countTimerRef.current)
    countTimerRef.current = setTimeout(flushSeasonCount, DEBOUNCE_MS)
  }

  async function handleDeleteSeason(): Promise<void> {
    if (!currentSeason) return
    const msg =
      seasons.length <= 1
        ? `这是最后只剩的一季(S${pad2(currentSeason.number)})。删除后这部作品就没有季结构了(已有集笔记保留)。继续?`
        : `删除 S${pad2(currentSeason.number)}?这一季的集笔记会保留在文件里但不再显示。`
    if (!confirm(msg)) return
    const next = seasons.filter((s) => s.number !== currentSeason.number)
    await setSeasons(book.id, next)
    // v1.6 简化:不再维护 selectedSeason,删完后自然回到"无季"分支
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

      {/* v1.6 起删除季选择器 tabs(S01/S02/... + 上一季/下一季 + 「+ 季」)——
          用户约定用 BookDetail「下一季」关联把不同季拆成不同 book,每本只追踪一季。
          季结构(seasons[])就地编辑只剩"X 集"inline + 「删除此季」两处。 */}

      {/* 当前季标题 + 集数就地编辑 + 删除季 —— v1.4 季结构下沉到 EpisodesPanel */}
      <div className="season-summary">
        <span className="season-summary-main">
          S{pad2(currentSeason.number)} ·{' '}
          <input
            className="season-count-input"
            type="number"
            min="0"
            value={countDraft}
            onChange={(e) => {
              setCountDraft(e.target.value)
              // v1.6 起:每次输入触发 debounce 实时写盘(默认 500ms 内连续输入只发一次 IPC)
              // —— 解决"用户改了 input 没失焦就切换作品 / 关闭 app 导致修改丢失"的场景
              // (BookForm v1.6 起季设置区块已走 onBlur 实时写盘,这里补齐 EpisodesPanel 的一致行为。
              //  v1.8 起 BookForm 被拆为 BookFormFields(只做加作品,提交即关),此处参考的是
              //  v1.6~v1.7 的 BookForm 编辑模式 onBlur 实时写盘设计)
              scheduleCountFlush()
            }}
            onBlur={flushSeasonCount}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            title="修改本季集数(失焦 / 回车 / 停 500ms 自动保存)"
            aria-label={`S${pad2(currentSeason.number)} 集数`}
          />
          <span className="season-count-unit">集</span>
          <span className="season-count-sep">· 已看 {watchedThisSeason}/{currentSeason.episodeCount}</span>
        </span>
        <button
          type="button"
          className="season-delete-btn"
          onClick={() => void handleDeleteSeason()}
          title={`删除 S${pad2(currentSeason.number)}`}
        >
          删除此季
        </button>
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
          onSetNote={(note) => {
            // v1.5:笔记内容被改时刷该集 lastModified
            // 后端:空 note 不刷;非空 note 才刷。这里只在 note 非空时传时间戳,
            // 避免"空串 = 删笔记"被错误地刷时间戳。
            const lm = note.trim() === '' ? undefined : Date.now()
            void setEpisodeNote(book.id, currentSeason.number, expandedEpisode, note, lm)
          }}
          onSetTitle={(title) => {
            const lm = title.trim() === '' ? undefined : Date.now()
            void setEpisodeTitle(book.id, currentSeason.number, expandedEpisode, title, lm)
          }}
          onSetStamps={(stamps) => {
            // v1.6 起:stamps 是 per-row 自跟踪(lastModified 在每条 stamp 上,
            // 见 StampList 注释 + apps/book-tracker/AGENTS.md §十.27),
            // 这里不再刷新 EpisodeRecord.lastModified —— 后者只反映该集
            // note / title 改动。 传 undefined 让 service 端 `if let Some(ts)` 分支跳过。
            void setEpisodeStamps(book.id, currentSeason.number, expandedEpisode, stamps, undefined)
          }}
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

  // v1.7 wikilink —— `[[` 触发 picker;book 透传自父组件
  const allBooks = useBooksStore((s) => s.books)
  const { handleChange: handleNoteChange, taRef: noteTaRef } = useWikilinkTextarea({
    book,
    value: noteDraft,
    setValue: (v) => {
      setNoteDraft(v)
      scheduleNoteFlush()
    }
  })

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
          ref={noteTaRef}
          value={noteDraft}
          onChange={handleNoteChange}
          onBlur={flushNote}
          rows={5}
          placeholder="自由写 —— 心得 / 摘录 / 备忘(输入 [[ 触发角色选择;空串 = 删除此集记录)"
        />
      </label>
      {/* v1.7 wikilink 预览 —— 解析 episode note 里的 [[xxx]] */}
      <WikilinkText
        text={noteDraft}
        currentBook={book}
        allBooks={allBooks}
        className="wikilink-preview-block"
      />
      {/* v1.3 时间戳笔记 —— 按 start 升序自动排列,逐条 add/edit/delete 都整体回写 */}
      <StampList
        book={book}
        allBooks={allBooks}
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
        {/* v1.6 起:EpisodeRecord.lastModified 只反映该集 note / title 改动;
            stamps 改动不再刷新此处(stamps 自带 per-row lastModified,
            在 StampList 行级显示)。watched 仍不刷。 */}
        {record?.lastModified !== undefined && (
          <span className="muted">
            最后修改：{formatLastModified(record.lastModified)}
          </span>
        )}
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
  /** v1.7 wikilink —— 当前作品(每个 stamp 的 textarea 触发 [[ 时 picker 用) */
  book: Book
  /** v1.7 wikilink —— 全作品列表(stamp note 预览解析跨作品用) */
  allBooks: Book[]
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
 * - **v1.7 wikilink**:每条 stamp 的 note textarea 集成 `[[` 触发 picker;
 *   紧凑场景(单行 + 自动撑高)所以 picker 用同款,但 stamp 内嵌上下文注入当前 book。
 */
function StampList({ book, allBooks, stamps, onChange }: StampListProps): JSX.Element {
  // 已排序的展示列表 —— 每次 props.stamps 变化重排(防止外部不按序传入)
  const sortedStamps = useMemo(() => sortStamps(stamps), [stamps])

  // v1.6 起:开始 / 结束 各拆成 [MM][:][SS] 两段独立 input —— ":" 是固定的视觉分隔符,
  // 用户只填数字(分 / 秒)。原因:整段单 input + 手敲 ":" 易输入 "12:34" / "1:2" /
  // "12 : 34"(空格) 等需要 parseStamp 容错的格式,UX 不直观;MM / SS 分两段自动拼 "mm:ss"
  // 即可,parseStamp 路径也走同一份。hh:mm:ss 仍由 StampRow 编辑时用更宽松的 mm:ss 表达
  // (本仓库数据时间戳以 mm:ss 为主,hh:mm:ss 用 stamp note 文字里写出来)。
  const [startMin, setStartMin] = useState<string>('')
  const [startSec, setStartSec] = useState<string>('')
  const [endMin, setEndMin] = useState<string>('')
  const [endSec, setEndSec] = useState<string>('')
  const [noteInput, setNoteInput] = useState<string>('')
  // 输入校验错误提示;空 = 无错误
  const [inputError, setInputError] = useState<string>('')
  // 自动聚焦 MM→SS —— MM 满 2 位时焦点跳到 SS,减少 Tab 切换
  const startSecRef = useRef<HTMLInputElement | null>(null)
  const endSecRef = useRef<HTMLInputElement | null>(null)

  /** 只允许非负整数,最多 maxLen 位;用于 MM / SS 输入过滤 */
  function digitsOnly(raw: string, maxLen: number): string {
    return raw.replace(/\D/g, '').slice(0, maxLen)
  }

  function handleAdd(): void {
    setInputError('')
    const noteTrimmed = noteInput.trim()
    // 校验 1:开始时间必填 —— MM / SS 都空才算空
    if (startMin === '' && startSec === '') {
      setInputError('请输入开始时间')
      return
    }
    // 拼成 "mm:ss" 给 parseStamp(parseStamp 接受任意位数的 mm / ss)
    const startStr = `${startMin}:${startSec}`
    const startSecNum = parseStamp(startStr)
    if (startSecNum === null) {
      setInputError(`开始时间格式错误:"${startStr}"(秒位需 < 60)`)
      return
    }
    // 校验 2:结束时间(可选)能解析
    let endSecNum: number | undefined = undefined
    const endHasContent = endMin !== '' || endSec !== ''
    if (endHasContent) {
      const endStr = `${endMin}:${endSec}`
      const parsed = parseStamp(endStr)
      if (parsed === null) {
        setInputError(`结束时间格式错误:"${endStr}"(秒位需 < 60)`)
        return
      }
      endSecNum = parsed
    }
    // 校验 3:end >= start(若给了 end)
    if (endSecNum !== undefined && endSecNum < startSecNum) {
      setInputError('结束时间不能早于开始时间')
      return
    }
    // v1.6 起:per-row lastModified —— 新建 stamp 一次性设当前时间戳,
    // 与 v1.5 Character.new lastModified 同款语义
    const newStamp: TimeStamp = {
      id: makeStampId(),
      start: startSecNum,
      end: endSecNum,
      note: noteTrimmed,
      lastModified: Date.now()
    }
    onChange(sortStamps([...sortedStamps, newStamp]))
    // 清空输入(让用户看清"已添加");焦点自然回落到第一个 input
    setStartMin('')
    setStartSec('')
    setEndMin('')
    setEndSec('')
    setNoteInput('')
  }

  function handleDelete(id: string): void {
    // 删除 stamp 不刷 lastModified(条目已消失);其他 stamp 原值保持
    onChange(sortStamps(sortedStamps.filter((s) => s.id !== id)))
  }

  function handleEditStart(id: string, raw: string): void {
    const parsed = parseStamp(raw)
    if (parsed === null) return // 解析失败静默不写(避免覆盖合法数据);用户撤销 / 重新输入
    const now = Date.now()
    onChange(
      sortStamps(
        sortedStamps.map((s) =>
          s.id === id ? { ...s, start: parsed, lastModified: now } : s
        )
      )
    )
  }

  function handleEditEnd(id: string, raw: string): void {
    const trimmed = raw.trim()
    const now = Date.now()
    if (trimmed === '') {
      // 空串 → 清除 end(回到单时间点);同样刷该 stamp 的 lastModified
      onChange(
        sortStamps(
          sortedStamps.map((s) =>
            s.id === id ? { ...s, end: undefined, lastModified: now } : s
          )
        )
      )
      return
    }
    const parsed = parseStamp(trimmed)
    if (parsed === null) return
    onChange(
      sortStamps(
        sortedStamps.map((s) =>
          s.id === id ? { ...s, end: parsed, lastModified: now } : s
        )
      )
    )
  }

  function handleEditNote(id: string, raw: string): void {
    const now = Date.now()
    onChange(
      sortStamps(
        sortedStamps.map((s) =>
          s.id === id ? { ...s, note: raw, lastModified: now } : s
        )
      )
    )
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
            <StampRow
              key={s.id}
              stamp={s}
              book={book}
              allBooks={allBooks}
              onEditNote={(raw) => handleEditNote(s.id, raw)}
              onDelete={() => handleDelete(s.id)}
            />
          ))}
        </ul>
      )}
      {/* 添加区:开始(MM:SS) / → / 结束(MM:SS 可选) / 笔记 / + */}
      <div className="stamp-add">
        {/* 开始 MM:SS —— ":" 是固定视觉分隔符,只填数字 */}
        <div className="stamp-time-pair">
          <input
            className="stamp-add-mm"
            value={startMin}
            onChange={(e) => {
              const v = digitsOnly(e.target.value, 2)
              setStartMin(v)
              // MM 满 2 位 → 自动跳到 SS,避免手敲 Tab
              if (v.length === 2) startSecRef.current?.focus()
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="00"
            aria-label="开始 分钟"
          />
          <span className="stamp-add-colon">:</span>
          <input
            ref={startSecRef}
            className="stamp-add-ss"
            value={startSec}
            onChange={(e) => setStartSec(digitsOnly(e.target.value, 2))}
            onKeyDown={(e) => {
              // Enter 直接添加(避免鼠标点 +)
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="00"
            aria-label="开始 秒钟"
          />
        </div>
        <span className="stamp-add-sep">→</span>
        {/* 结束 MM:SS —— 留空 = 单时间点(只有"这一刻") */}
        <div className="stamp-time-pair">
          <input
            className="stamp-add-mm"
            value={endMin}
            onChange={(e) => {
              const v = digitsOnly(e.target.value, 2)
              setEndMin(v)
              if (v.length === 2) endSecRef.current?.focus()
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="--"
            aria-label="结束 分钟"
          />
          <span className="stamp-add-colon">:</span>
          <input
            ref={endSecRef}
            className="stamp-add-ss"
            value={endSec}
            onChange={(e) => setEndSec(digitsOnly(e.target.value, 2))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="--"
            aria-label="结束 秒钟"
          />
        </div>
        <input
          className="stamp-add-note"
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          placeholder="这一段讲什么"
          onKeyDown={(e) => {
            // Enter 直接添加
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
        时间填分:秒(秒位需 &lt; 60);留空结束 = 单时间点(标记"这一刻")
      </p>
    </div>
  )
}

// ==================== 子组件:StampRow (per-stamp 行,v1.6 起 textarea 多行 + 自动撑高) ====================

interface StampRowProps {
  stamp: TimeStamp
  /** v1.7 wikilink —— 当前 book,`[[` 触发 picker 用 */
  book: Book
  /** v1.7 wikilink —— 全作品列表(预览跨作品解析用) */
  allBooks: Book[]
  onEditNote: (raw: string) => void
  onDelete: () => void
}

/**
 * 单条 stamp 行 —— 用户最关心的"该片段讲什么"用 textarea 多行展示全部内容。
 *
 * 设计要点(v1.6 起):
 * - **多行展示**:`<textarea>` 替代原先 `<input>`;用户写长笔记不再被截断,
 *   Enter 创建换行(与 episode-level note / character note 的 textarea 体验一致)
 * - **自动撑高**:用 useEffect + scrollHeight 把高度自动撑到内容;max-height
 *   兜底避免一条超长笔记把整个 episode 编辑器撑爆(超出滚动)
 * - **per-row lastModified**:沿用 v1.6 决定,行级显示 + 不影响 EpisodeRecord.lastModified
 * - **v1.7 wikilink**:textarea 集成 `[[` 触发 picker;选完插入 `[[name]]` 后,
 *   useEffect 监听 stamp.note 变化会自动重算高度,无需手工 resize。
 */
function StampRow({ stamp, book, allBooks, onEditNote, onDelete }: StampRowProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 自动撑高:mount + stamp.note 变化时(外部 store 更新或本组件 onChange)
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    // 先设 auto 让 scrollHeight 反映真实内容高度,再设回 scrollHeight
    // (避免内容减少后高度不收缩)
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [stamp.note])

  // v1.7 wikilink —— `[[` 触发 picker;note 是 stamp.note(每条 stamp 独立 note)。
  // 选完 name 后 setValue 写入 stamp.note(通过 onEditNote 上抛给 StampList → onChange)
  const { handleChange: handleNoteChange, taRef: wikilinkTaRef } = useWikilinkTextarea({
    book,
    value: stamp.note,
    setValue: (v) => onEditNote(v)
  })

  // 合并两个 ref —— 撑高需要 textareaRef,wikilink hook 也需要 ref。
  // 用 callback ref 把两者合一
  function setCombinedRef(el: HTMLTextAreaElement | null): void {
    textareaRef.current = el
    wikilinkTaRef.current = el
  }

  return (
    <li className="stamp-row">
      <span className="stamp-row-time">
        {formatStamp(stamp.start)}
        {stamp.end !== undefined && (
          <>
            {' → '}
            {formatStamp(stamp.end)}
          </>
        )}
      </span>
      <textarea
        ref={setCombinedRef}
        className="stamp-row-note"
        value={stamp.note}
        rows={1}
        onChange={(e) => {
          // 先让 wikilink hook 处理(透传 value + 检测 [[)
          handleNoteChange(e)
          // 然后立即撑高(不等 React re-render)—— 用户敲键时高度跟随
          e.currentTarget.style.height = 'auto'
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
        }}
        placeholder="(无笔记;Enter 换行)"
      />
      {/* per-row lastModified —— 显示"该条"最后修改时间
          (与 EpisodeRecord.lastModified 解耦,后者只反映 note / title) */}
      {stamp.lastModified !== undefined ? (
        <span
          className="stamp-row-lm muted"
          title="该时间戳最后修改时间(per-row,与整集最后修改时间独立)"
        >
          {formatLastModified(stamp.lastModified)}
        </span>
      ) : (
        <span className="stamp-row-lm muted stamp-row-lm-empty" />
      )}
      <button
        type="button"
        className="stamp-row-del"
        onClick={onDelete}
        title="删除这条时间戳"
      >
        ×
      </button>
    </li>
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 防止 lint:确保 parseEpisodeKey 用到(未来批量操作可能用得上)
void parseEpisodeKey
