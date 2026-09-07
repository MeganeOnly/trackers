// 集笔记面板 —— BookDetail 的「集笔记」区块
//
// 仅当 book.kind === 'tv' | 'anime' 时渲染(由 BookDetail 决定是否引入)。
// 职责(v1.6 简化 + 进一步收敛):
// - 当前唯一季的集网格(点击格子展开 / 双击切换 watched)
//   —— **v1.6 起不再有季选择器 tabs**:用户约定"不同季用 nextSeasonId 串成多个 book",
//   每本 book 只追踪一季;季切换 UI 已删,改用 BookDetail「上一季 / 下一季」区块跳转。
//   季结构(seasons[])仍保留 —— 一本书可能因历史遗留 / 误填仍有多个 seasons,
//   这里取 `seasons[0]` 显示(简化逻辑,不再维护 selectedSeason 状态)。
// - 展开区:标题输入 / watched toggle / 笔记 textarea / 时间戳笔记 stamps / 删除按钮
// - 顶部 stats 行:「已看 X / [Y] · N 条笔记」+ 快速操作(-1 / +1 / 清空)
//
// 拆分(svg-2026-09, 响应 DSH 插件 700 行/30KB 阈值):
// - EpisodesPanel.StampList.tsx  StampList + StampRow + makeStampId(本文件原 1104 行 → 后续 ~480 行)
// 本文件保留: EpisodesPanel 主组件 + EpisodeCell + EpisodeEditor + helpers(pad2 / collectSeasonEpisodes)
//
// 季结构编辑(v1.4 保留 v1.6 + 进一步简化):
// - 季集数 InlineField(在 stats 行内联):仅改当前季的 episodeCount,其他季不动
// - **移除「删除此季」按钮**:留孤立按钮会破坏季链语义
// - **v1.6 移除 「+ 季」按钮 + tabs 切换**:用户加新季的路径改为"新建一本 book + 设下一季"
// - 同步策略:**不**联动改 book.progress.total / progress.current;理由见 AGENTS.md §十.24

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBooksStore } from '../store/books'
import { useEpisodeStats, useEpisodesForBook, useSeasonsForBook } from '../store/selectors'
import { episodeKey, formatLastModified } from '@shared/types'
import type { Book, EpisodeRecord, TimeStamp } from '@shared/types'
import { WikilinkText } from './WikilinkText'
import { useWikilinkTextarea } from './useWikilinkTextarea'
import { InlineField } from './InlineField'
import { StampList } from './EpisodesPanel.StampList'

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
  // v1.4 季结构就地编辑 —— 整段替换 seasons(v1.6 起只用于"X 集"inline,
  // 不再有「+ 季」和季切换 / 「删除此季」—— 加新季走"新建 book + 设下一季"路径,
  // 删季等于删除整本 book,因为下一季通过 BookDetail「下一季」关联直接跳转)
  const setSeasons = useBooksStore((s) => s.setSeasons)

  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null)
  // 季集数 inline 编辑态 —— InlineField 的「预览 ↔ 编辑」二态:
  // 现在 InlineField 直接嵌在「已看 X /」后面(替换 Y),用 inline 模式不渲染 label,
  // 跟 BookDetail 的「作品类型」同款「看起来跟普通文字一样,点上去才出白框」。
  const [editingField, setEditingField] = useState<string | null>(null)

  // book.id 切换时收起展开的格子(v1.6 简化:不再有 selectedSeason state)
  useEffect(() => {
    setExpandedEpisode(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // 当前季的元信息 —— v1.6 简化:不再维护 selectedSeason 状态,直接取 seasons[0]
  // (用户约定不同季用 nextSeasonId 串成多本 book,每本只追踪一季;若某本 book 历史
  // 遗留多季,这里只显示 seasons[0];仍保留 seasons[] 以便"X 集"inline 编辑还能用)
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

  // v1.4 季结构就地编辑 —— 进一步简化后只剩"X 集" inline input(无 "+ 季" / 切换季 / 「删除此季」)
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

  if (!currentSeason) {
    return (
      <section className="episodes-panel">
        <h3 className="episodes-panel-title">集笔记</h3>
        <p className="muted">这部作品暂无季信息 —— 在编辑表单里加季后才能记录单集笔记。</p>
      </section>
    )
  }

  const seasonEps = collectSeasonEpisodes(currentSeason.number, currentSeason.episodeCount, episodes)

  return (
    <section className="episodes-panel">
      <h3 className="episodes-panel-title">集笔记</h3>
      {/* 顶部统计 + 快速操作 —— 「已看 X / Y」中的 Y 用 InlineField 内联替换,
          点上去改本季集数;空值/非法值 blur 自动还原。
          Enter / 失焦 → flushSeasonCount(即时写盘);onChange → scheduleCountFlush(500ms debounce)。
          **关键**:InlineField 必须跟「/」在同一个 <span> 里,避免被 .episodes-stats 的 10px flex gap
          撑开 —— 否则「11 / 40」视觉上变成「11 / [ 40 ]」,40 离 / 太远,不像老版的「20/20」紧贴。 */}
      <div className="episodes-stats">
        <span>
          已看 <b>{stats.watchedCount}</b> /{' '}
          <InlineField
            fieldId="seasonCount"
            label=""
            inline
            display={String(currentSeason.episodeCount)}
            value={countDraft}
            onChange={(v) => {
              setCountDraft(v)
              // 每次输入触发 debounce 实时写盘(500ms 内连续输入只发一次 IPC)——
              // 解决"用户改了 input 没失焦就切换作品 / 关闭 app 导致修改丢失"的场景
              scheduleCountFlush()
            }}
            editing={editingField === 'seasonCount'}
            onActivate={() => setEditingField('seasonCount')}
            onDeactivate={() => {
              setEditingField(null)
              // 失焦 / Esc / Enter → flushSeasonCount;flushSeasonCount 内部判空 / 非法 / 未变,自动还原或跳过 IPC
              flushSeasonCount()
            }}
            kind="number"
            emptyPlaceholder="?"
            min={0}
          />
        </span>
        <span className="dot">·</span>
        <span>
          {stats.noteCount} 条笔记
        </span>
        <div className="episodes-actions">
          <button className="btn-secondary" onClick={() => void handleBump(-1)} disabled={!book.progress}>
            -1
          </button>
          <button className="btn-secondary" onClick={() => void handleBump(+1)}>
            +1
          </button>
          {/* 清空按钮 —— 必须二次确认(handleClear 内部 confirm),避免误点删所有 watched/笔记/标题 */}
          <button className="btn-secondary episodes-clear" onClick={() => void handleClear()}>
            清空
          </button>
        </div>
      </div>

      {/* v1.6 起删除季选择器 tabs(S01/S02/... + 上一季/下一季 + 「+ 季」)——
          用户约定用 BookDetail「下一季」关联把不同季拆成不同 book,每本只追踪一季。
          「删除此季」按钮也已移除 —— 引入下一季通过 BookDetail「下一季」关联,删除本季
          等于删除整本 book(走 BookDetail 详情页的删除按钮),留孤立「删除此季」按钮
          会破坏季链语义(下一季 → 上一季的反向链找不到本季,但本季还在原地)。
          季集数编辑已上移到 stats 行(InlineField inline 模式替换"已看 X / Y"的 Y),
          S01 前缀随之删除 —— 每本只追踪一季,不需要再标 S0X 区分。 */}

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
  // 是否有时间戳笔记 —— 集网格右上角加 🕐 + ::before 小点提示,
  // 跟 hasNote 的左下角 📝 + ::after 小点对称(分两组角标:左上 watched ✓ / 右上 时间戳 / 右下 笔记)
  const hasStamps = !!record?.stamps && record.stamps.length > 0
  return (
    <div
      className={`episode-cell${watched ? ' watched' : ''}${hasNote ? ' has-note' : ''}${hasStamps ? ' has-stamps' : ''}${expanded ? ' expanded' : ''}`}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.preventDefault()
        onToggleWatched()
      }}
      title={`S${pad2(season)}E${pad2(episode)}${hasTitle ? ` · ${record!.title}` : ''}${hasStamps ? ` · 含 ${record!.stamps!.length} 条时间戳笔记` : ''}\n单击展开 / 双击标记 watched`}
    >
      <span className="episode-cell-num">{episode}</span>
      {watched && <span className="episode-cell-tick">✓</span>}
      {hasNote && <span className="episode-cell-note-mark">📝</span>}
      {hasStamps && <span className="episode-cell-stamp-mark">🕐</span>}
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
  // v2025-09:notesDirty 标记 —— 用户在 EpisodeEditor 改过本地 noteDraft(未保存)。
  // 当 store 里的 record.note 被外部更新时:
  // - dirty=false:本地草稿未动 → 同步刷新到本地(用户能看到 modal 的最新结果)
  // - dirty=true :本地有用户未保存输入 → 不覆盖(避免 IPC 异步回灌吞掉用户草稿,
  //   经典「乐观更新 + 异步回灌」竞态的治本模式 —— 主笔记 BookNotesModal /
  //   BookDetail 已有同款保护,见 apps/book-tracker/AGENTS.md §十 + dev-notes 2026-09)。
  const [notesDirty, setNotesDirty] = useState(false)
  // v2025-09:lastSentNoteRef —— 记录最后一次发出去的 note 值。
  // 当 IPC 异步回灌时:
  // - 回灌的 record.note === lastSentNoteRef.current → 是我刚发的旧值,放心同步
  // - 回灌的 record.note !== lastSentNoteRef.current → 说明用户在 IPC 期间又敲了新字符,
  //   不能用回灌的旧值覆盖本地 noteDraft(dirty flag 不够,因为 setNoteDraft 之后
  //   dirty=true,IPC 回灌时 record.note 仍是 old,lastSentRef=old,效果一样;
  //   但若用户在 IPC 期间敲了又删干净,noteDraft===lastSent 但 dirty=true,这层拦截救命)
  const lastSentNoteRef = useRef<string>(record?.note ?? '')

  // record 变化(外部 store 更新)→ 同步本地 draft(避免覆盖用户正在敲的内容)
  // v2025-09 加 dirty flag + lastSentRef 双闸门:
  // - dirty=true → 不动(用户在敲,IPC 回灌不能覆盖)
  // - record.note === lastSentNoteRef → 是自己刚发的,放心同步
  // - 否则 → 不动(IPC 回灌比我刚发的还旧,用户在持续敲)
  useEffect(() => {
    setTitleDraft(record?.title ?? '')
  }, [record?.title])
  useEffect(() => {
    if (notesDirty) return
    const incoming = record?.note ?? ''
    if (incoming === lastSentNoteRef.current) {
      // IPC 回灌的是我刚发的旧值 → 同步刷新(同时重置 lastSentRef,因为这次同步后
      // 本地与 store 一致了)
      setNoteDraft(incoming)
      lastSentNoteRef.current = incoming
    } else if (incoming !== noteDraft) {
      // 完全外部的更新(如其他面板编辑、保存返回等)→ 同步刷新
      setNoteDraft(incoming)
      lastSentNoteRef.current = incoming
      setNotesDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notesDirty / noteDraft 故意不放进依赖(见上方注释)
  }, [record?.note])

  // v1.7 wikilink —— `[[` 触发 picker;book 透传自父组件
  const allBooks = useBooksStore((s) => s.books)
  // v2025-09:setNotesWithDirty —— useCallback 包装,setNoteDraft 同步 setNotesDirty(true),
  // 让 effect 看到 dirty=true 早退(IPC 回灌不覆盖用户草稿)。
  const setNotesWithDirty = useCallback((v: string): void => {
    setNoteDraft(v)
    setNotesDirty(true)
  }, [])
  const { handleChange: handleNoteChange, taRef: noteTaRef } = useWikilinkTextarea({
    book,
    value: noteDraft,
    setValue: setNotesWithDirty
  })

  function flushTitle(): void {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    const trimmed = titleDraft.trim()
    // 空串 → 删 title 字段(由 service 兜底,这里就传原始 draft 即可)
    onSetTitle(titleDraft)
  }
  function flushNote(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    // 记录最后一次发出去的值,effect 用它判断 IPC 回灌是不是「自己刚发的旧值」
    lastSentNoteRef.current = noteDraft
    onSetNote(noteDraft)
    // IPC 已发出 → 重置 dirty,允许后续外部 store 更新正常同步回来
    setNotesDirty(false)
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
