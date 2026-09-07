// EpisodesPanel 时间戳笔记 (StampList + StampRow)
//
// 从 EpisodesPanel.tsx 拆出(响应 DSH 插件 700 行/30KB 阈值)。
// 这里所有 stamp 相关的输入校验 / 排序 / 整体回写 / wikilink 集成 / 自动撑高
// 都集中维护,EpisodesPanel.tsx 只负责面板外壳 + 集网格 + 季集数编辑。
//
// 父组件 EpisodesPanel 持有 stamps 数组(读自 store,store action 走 setEpisodeStamps
// 整体替换),本文件对 stamps 数组做「整体回写」语义:add / edit / delete 都构造
// 新数组 + sortStamps 再 onChange,避免单条 IPC 的并发冲突。
//
// 数据格式(v1.3 起):
// - TimeStamp = { id: UUID, start: 秒, end?: 秒, note: 文本, lastModified?: 毫秒 }
// - 写盘:数组为空 → 不写字段;单条 stamp 的 end/note 允许空串/null
// - per-row lastModified(v1.6 修正):只在该 stamp 的 start/end/note 任一被改时刷新
//
// 测试入口:`export const StampRow` 给 __tests__ 用(产品代码走 <StampList> 内部渲染)。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book, TimeStamp } from '@shared/types'
import { formatLastModified, formatStamp, parseStamp, sortStamps } from '@shared/types'
import { useWikilinkTextarea } from './useWikilinkTextarea'

const DEBOUNCE_MS = 500

// ===== StampList =====

export interface StampListProps {
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
 * - **v1.7 wikilink**:每条 stamp 的 note textarea 集成 `[[` 触发 picker
 */
export function StampList({ book, allBooks, stamps, onChange }: StampListProps): JSX.Element {
  // 已排序的展示列表 —— 每次 props.stamps 变化重排(防止外部不按序传入)
  const sortedStamps = useMemo(() => sortStamps(stamps), [stamps])

  // v1.6 起:开始 / 结束 各拆成 [MM][:][SS] 两段独立 input —— ":" 是固定的视觉分隔符,
  // 用户只填数字(分 / 秒)。原因:整段单 input + 手敲 ":" 易输入 "12:34" / "1:2" /
  // "12 : 34"(空格) 等需要 parseStamp 容错的格式,UX 不直观;MM / SS 分两段自动拼 "mm:ss"
  // 即可,parseStamp 路径也走同一份。
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

  /** v2025-09 起:start inline 编辑 —— StampRow blur / 回车时直接传 number */
  function handleEditStart(id: string, start: number): void {
    const now = Date.now()
    onChange(
      sortStamps(
        sortedStamps.map((s) =>
          s.id === id ? { ...s, start, lastModified: now } : s
        )
      )
    )
  }

  /** v2025-09 起:end inline 编辑 —— undefined 表示清除 end(单时间点) */
  function handleEditEnd(id: string, end: number | undefined): void {
    const now = Date.now()
    onChange(
      sortStamps(
        sortedStamps.map((s) =>
          s.id === id ? { ...s, end, lastModified: now } : s
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
              onEditStart={(start) => handleEditStart(s.id, start)}
              onEditEnd={(end) => handleEditEnd(s.id, end)}
              onDelete={() => handleDelete(s.id)}
            />
          ))}
        </ul>
      )}
      {/* 添加区:开始(MM:SS) / → / 结束(MM:SS 可选) / 笔记 / + */}
      <div className="stamp-add">
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

// ===== StampRow =====

interface StampRowProps {
  stamp: TimeStamp
  /** v1.7 wikilink —— 当前 book,`[[` 触发 picker 用 */
  book: Book
  /** v1.7 wikilink —— 全作品列表(预览跨作品解析用) */
  allBooks: Book[]
  onEditNote: (raw: string) => void
  /** v2025-09 修:start 时间戳 inline 编辑(单击时间戳进入编辑模式);失焦/回车 flush */
  onEditStart: (start: number) => void
  /** v2025-09 修:end 时间戳 inline 编辑;传 undefined 表示清除 end(单时间点) */
  onEditEnd: (end: number | undefined) => void
  onDelete: () => void
}

/**
 * 单条 stamp 行 —— 用户最关心的"该片段讲什么"用 textarea 多行展示全部内容。
 *
 * 设计要点(v1.6 起,v2025-09 修):
 * - **多行展示**:`<textarea>` 替代原先 `<input>`;用户写长笔记不再被截断
 * - **本地 draft + debounce flush**(v2025-09 修):之前直接 `value={stamp.note}` + 每次
 *   keystroke 同步触发整 stamps 数组重建 + IPC,React 18 controlled input 会重置 DOM
 *   把用户的第二次 keystroke 吞掉,导致 `[[` 检测错过 → picker 不打开
 * - **自动撑高**:用 useEffect + scrollHeight 把高度自动撑到内容;max-height 兜底
 * - **per-row lastModified**:沿用 v1.6 决定,行级显示 + 不影响 EpisodeRecord.lastModified
 * - **v1.7 wikilink**:textarea 集成 `[[` 触发 picker
 * - **v2025-09 加 start/end inline 编辑**:单击时间戳文字 → 切换到 inline 编辑态;
 *   编辑态 start / end 各 2 段 input(MM / SS),end 可留空表示单时间点
 */
function StampRowInner({
  stamp, book, allBooks, onEditNote, onEditStart, onEditEnd, onDelete
}: StampRowProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // v2025-09 修:本地 noteDraft —— 跟 CharacterEditor 同款,解决 React 18 controlled
  // input 吞连续 keystroke 的问题
  const [noteDraft, setNoteDraft] = useState<string>(stamp.note)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v2025-09:notesDirty 标记 —— 用户改过本地 noteDraft(未保存)。
  // 跟 EpisodeEditor / CharacterEditor 同款(见 EpisodeEditor 注释):脏状态下禁止
  // useEffect 用外部 store 更新覆盖本地草稿,治本「乐观更新 + 异步回灌」竞态。
  const [notesDirty, setNotesDirty] = useState(false)
  // v2025-09:lastSentNoteRef —— 记录最后一次发出去的 note 值,用于区分
  // 「IPC 回灌的是我刚发的旧值」vs「IPC 回灌的是比我还旧的版本」。
  const lastSentNoteRef = useRef<string>(stamp.note)

  // 外部 store 更新(IPC flush 回来 / wikilink 插入 / 其他 stamp 改动)→ 同步本地 draft;
  // 配合下面 flushNote 的判断("draft 跟当前 stamp.note 一致 → 跳过 IPC")避免覆盖用户
  // 正在敲的内容
  //
  // v2025-09 加 dirty flag + lastSentRef 双闸门(跟 EpisodeEditor 严格对齐):
  // - dirty=true → 不动(用户在敲)
  // - store 值 === lastSentRef → 是自己刚发的旧值,放心同步
  // - 否则 → 完全外部更新,同步刷新 + 重置 dirty + 更新 lastSentRef
  useEffect(() => {
    if (notesDirty) return
    const incoming = stamp.note
    if (incoming === lastSentNoteRef.current) {
      setNoteDraft(incoming)
      lastSentNoteRef.current = incoming
    } else if (incoming !== noteDraft) {
      setNoteDraft(incoming)
      lastSentNoteRef.current = incoming
      setNotesDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notesDirty / noteDraft 故意不放进依赖
  }, [stamp.note])

  function flushNote(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    // 没改 → 不发 IPC(避免无谓 IPC;跟 CharacterEditor 的"什么都没改,老时间不变"语义一致)
    if (noteDraft === stamp.note) return
    // 发送前记录:这是「我刚发出去」的值。IPC 回灌后 effect 用此判断能不能覆盖本地草稿
    lastSentNoteRef.current = noteDraft
    onEditNote(noteDraft)
    // IPC 已发出 → 重置 dirty,允许后续外部 stamp.note 更新正常同步回来
    setNotesDirty(false)
  }
  function scheduleNoteFlush(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(flushNote, DEBOUNCE_MS)
  }

  // 自动撑高:mount + stamp.note 变化时(外部 store 更新)重算;onChange 时手工
  // 撑高不等 React re-render(用户敲键时高度跟随)
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    // 先设 auto 让 scrollHeight 反映真实内容高度,再设回 scrollHeight
    // (避免内容减少后高度不收缩)
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [stamp.note])

  // v1.7 wikilink —— `[[` 触发 picker。setValue 走 setNotesWithDirty + scheduleFlush,
  // 跟 CharacterEditor / EpisodeEditor 同款;不直接 onEditNote 避免 React 18
  // controlled input 吞 keystroke。setNotesWithDirty 同步 setNotesDirty(true),
  // 让 IPC 异步回灌时 effect 早退不覆盖本地草稿。
  const setNotesWithDirty = useCallback((v: string): void => {
    setNoteDraft(v)
    setNotesDirty(true)
  }, [])
  const { handleChange: handleNoteChange, taRef: wikilinkTaRef } = useWikilinkTextarea({
    book,
    value: noteDraft,
    setValue: setNotesWithDirty
  })

  // 合并两个 ref —— 撑高需要 textareaRef,wikilink hook 也需要 ref。
  // 用 callback ref 把两者合一
  function setCombinedRef(el: HTMLTextAreaElement | null): void {
    textareaRef.current = el
    wikilinkTaRef.current = el
  }

  // ============= v2025-09 加:start / end inline 编辑状态 =============
  const [editingTime, setEditingTime] = useState<boolean>(false)
  // 编辑态本地 draft —— mm / ss 各一段,跟 StampList 添加区同款
  const [startMin, setStartMin] = useState<string>('')
  const [startSec, setStartSec] = useState<string>('')
  const [endMin, setEndMin] = useState<string>('')
  const [endSec, setEndSec] = useState<string>('')
  const startMinRef = useRef<HTMLInputElement | null>(null)
  const startSecRef = useRef<HTMLInputElement | null>(null)
  const endMinRef = useRef<HTMLInputElement | null>(null)
  const endSecRef = useRef<HTMLInputElement | null>(null)
  // v2025-09:用 ref 标记"用户主动取消",避免 Esc 后 onBlur 仍触发 flushEditTime 把数据写出去
  const cancelledRef = useRef<boolean>(false)
  // v2025-09:timeDirty 标记 —— 用户在 inline 编辑态改了 MM/SS(未保存)。
  // 当 store 里的 stamp.start / stamp.end 被外部更新时(IPC 回灌),保护本地编辑草稿。
  // 跟 noteDirty 同款模式,见 EpisodeEditor 注释 + dev-notes 2026-09。
  const [timeDirty, setTimeDirty] = useState(false)
  // v2025-09:lastSentStartRef / lastSentEndRef —— 记录最后一次发出去的 start/end 值。
  // 用于区分 IPC 回灌的「自己刚发的旧值」vs「比我还旧的版本」。
  const lastSentStartRef = useRef<number>(stamp.start)
  const lastSentEndRef = useRef<number | undefined>(stamp.end)

  // v2025-09:stamp.start / stamp.end 外部更新 → 同步本地 state。
  // 编辑态(exitingTime=true)不清 MM/SS,避免覆盖用户正在敲的字符;
  // dirty=true 也保护(用户刚改了 MM/SS,IPC 还没发出去,不能动)。
  // 退出编辑态后清空 MM/SS draft(下次 beginEditTime 会重新回填新值)。
  useEffect(() => {
    if (editingTime) return
    if (timeDirty) return
    const incomingStart = stamp.start
    const incomingEnd = stamp.end
    if (incomingStart !== lastSentStartRef.current || incomingEnd !== lastSentEndRef.current) {
      // 完全外部更新(IPC 回灌或其他 stamp 改动)→ 清 MM/SS draft + 同步 lastSent
      setStartMin('')
      setStartSec('')
      setEndMin('')
      setEndSec('')
      lastSentStartRef.current = incomingStart
      lastSentEndRef.current = incomingEnd
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editingTime/timeDirty 故意不放依赖
  }, [stamp.start, stamp.end])

  /** 把秒数拆成 mm / ss 两段(用于进入编辑态时回填) */
  function secondsToPair(totalSec: number): { min: string; sec: string } {
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return { min: String(m).padStart(2, '0'), sec: String(s).padStart(2, '0') }
  }

  function beginEditTime(): void {
    cancelledRef.current = false
    const sp = secondsToPair(stamp.start)
    setStartMin(sp.min)
    setStartSec(sp.sec)
    if (stamp.end !== undefined) {
      const ep = secondsToPair(stamp.end)
      setEndMin(ep.min)
      setEndSec(ep.sec)
    } else {
      setEndMin('')
      setEndSec('')
    }
    setTimeDirty(false) // 进入编辑态 → 重置 dirty(等待用户改)
    setEditingTime(true)
    // 自动聚焦到 start 的 mm 输入(下一 tick 让 React 先 commit)
    setTimeout(() => startMinRef.current?.focus(), 0)
  }

  function cancelEditTime(): void {
    // 用 ref 标记"取消"——setEditingTime 是 React state 异步生效,
    // flushEditTime 在 onBlur 时被调时还没拿到新 editingTime,会走"写入"分支误保存。
    cancelledRef.current = true
    setEditingTime(false)
  }

  function flushEditTime(): void {
    // v2025-09:用户主动取消(Esc)→ 不写 store,直接还原
    if (cancelledRef.current) {
      cancelledRef.current = false
      setEditingTime(false)
      return
    }
    // start 必填(MM / SS 都空才算空,但至少 SS 不空才能 parseStamp;同 StampList 添加区校验)
    if (startMin === '' && startSec === '') {
      // 没改 → 切回展示
      setEditingTime(false)
      return
    }
    const startStr = `${startMin}:${startSec}`
    const startSecNum = parseStamp(startStr)
    if (startSecNum === null) {
      // 解析失败 → 还原(不写 store,保留原 stamp)
      setEditingTime(false)
      return
    }
    let endSecNum: number | undefined = undefined
    const endHasContent = endMin !== '' || endSec !== ''
    if (endHasContent) {
      const endStr = `${endMin}:${endSec}`
      const parsed = parseStamp(endStr)
      if (parsed === null) {
        // end 解析失败 → 仅写 start,保留原 end
        setEditingTime(false)
        if (startSecNum !== stamp.start) {
          lastSentStartRef.current = startSecNum
          onEditStart(startSecNum)
        }
        setTimeDirty(false)
        return
      }
      endSecNum = parsed
    }
    // end < start → 静默不写(同 StampList 添加区校验,避免脏数据)
    if (endSecNum !== undefined && endSecNum < startSecNum) {
      setEditingTime(false)
      return
    }
    setEditingTime(false)
    // 什么都没改 → 不写(避免"什么都没改但 IPC + lastModified 刷新" —— 跟
    // CharacterEditor.flushNote("draft 跟当前 stamp.note 一致 → 跳过")同款语义)
    const startChanged = startSecNum !== stamp.start
    const endChanged = endSecNum !== stamp.end
    if (!startChanged && !endChanged) {
      setTimeDirty(false)
      return
    }
    // 发送前记录:这是「我刚发出去」的值。IPC 回灌后 effect 用此判断能不能覆盖本地草稿
    if (startChanged) {
      lastSentStartRef.current = startSecNum
      onEditStart(startSecNum)
    }
    if (endChanged) {
      lastSentEndRef.current = endSecNum
      onEditEnd(endSecNum)
    }
    // IPC 已发出 → 重置 dirty,允许后续外部 stamp.start/end 更新正常同步回来
    setTimeDirty(false)
  }

  function digitsOnly(raw: string, maxLen: number): string {
    return raw.replace(/\D/g, '').slice(0, maxLen)
  }

  // v2025-09:MM/SS 修改 → 同步 setTimeDirty(true),让 IPC 异步回灌不覆盖本地编辑草稿
  const setStartMinWithDirty = useCallback((v: string): void => {
    setStartMin(v)
    setTimeDirty(true)
  }, [])
  const setStartSecWithDirty = useCallback((v: string): void => {
    setStartSec(v)
    setTimeDirty(true)
  }, [])
  const setEndMinWithDirty = useCallback((v: string): void => {
    setEndMin(v)
    setTimeDirty(true)
  }, [])
  const setEndSecWithDirty = useCallback((v: string): void => {
    setEndSec(v)
    setTimeDirty(true)
  }, [])

  return (
    <li className="stamp-row">
      {editingTime ? (
        // 编辑态:start mm + ss,→,end mm + ss(end 可空)
        <span className="stamp-row-time stamp-row-time-edit">
          <input
            ref={startMinRef}
            className="stamp-edit-mm"
            value={startMin}
            onChange={(e) => {
              const v = digitsOnly(e.target.value, 2)
              setStartMinWithDirty(v)
              if (v.length === 2) startSecRef.current?.focus()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                flushEditTime()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEditTime()
              }
            }}
            onBlur={() => {
              // blur → 自动 flush(让用户点别处也能保存)
              flushEditTime()
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="00"
            aria-label="开始 分钟"
            data-testid="stamp-row-start-min"
          />
          <span className="stamp-add-colon">:</span>
          <input
            ref={startSecRef}
            className="stamp-edit-ss"
            value={startSec}
            onChange={(e) => setStartSecWithDirty(digitsOnly(e.target.value, 2))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                flushEditTime()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEditTime()
              }
            }}
            onBlur={flushEditTime}
            inputMode="numeric"
            maxLength={2}
            placeholder="00"
            aria-label="开始 秒钟"
            data-testid="stamp-row-start-sec"
          />
          <span className="stamp-add-sep">→</span>
          <input
            ref={endMinRef}
            className="stamp-edit-mm"
            value={endMin}
            onChange={(e) => {
              const v = digitsOnly(e.target.value, 2)
              setEndMinWithDirty(v)
              if (v.length === 2) endSecRef.current?.focus()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                flushEditTime()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEditTime()
              }
            }}
            inputMode="numeric"
            maxLength={2}
            placeholder="--"
            aria-label="结束 分钟"
            data-testid="stamp-row-end-min"
          />
          <span className="stamp-add-colon">:</span>
          <input
            ref={endSecRef}
            className="stamp-edit-ss"
            value={endSec}
            onChange={(e) => setEndSecWithDirty(digitsOnly(e.target.value, 2))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                flushEditTime()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEditTime()
              }
            }}
            onBlur={flushEditTime}
            inputMode="numeric"
            maxLength={2}
            placeholder="--"
            aria-label="结束 秒钟"
            data-testid="stamp-row-end-sec"
          />
        </span>
      ) : (
        // 展示态:单击进入编辑
        <span
          className="stamp-row-time stamp-row-time-clickable"
          onClick={beginEditTime}
          title="单击修改开始 / 结束时间"
          data-testid="stamp-row-time-display"
        >
          {formatStamp(stamp.start)}
          {stamp.end !== undefined && (
            <>
              {' → '}
              {formatStamp(stamp.end)}
            </>
          )}
        </span>
      )}
      <textarea
        ref={setCombinedRef}
        className="stamp-row-note"
        value={noteDraft}
        rows={1}
        onChange={(e) => {
          // 先让 wikilink hook 处理(透传 value + 检测 [[);setValue 走 setNoteDraft + scheduleFlush
          handleNoteChange(e)
          // 然后立即撑高(不等 React re-render)—— 用户敲键时高度跟随
          e.currentTarget.style.height = 'auto'
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
        }}
        onBlur={flushNote}
        placeholder="(无笔记;Enter 换行)"
        data-testid="stamp-row-note-input"
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

/**
 * 公开的 StampRow —— 仅供 __tests__ 直接 mount 真实产品组件用。
 * 生产代码仍然通过 <StampList> 的内部 StampRow 渲染(走 onEditStart / onEditEnd 等 prop)。
 */
export const StampRow = StampRowInner

/** 生成稳定 UUID;优先 `crypto.randomUUID()`(浏览器原生),降级到时间戳 + 随机数。 */
function makeStampId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 降级方案:时间戳 + 4 位随机十六进制(同 id 概率极低,够用)
  return `stamp-${Date.now()}-${Math.floor(Math.random() * 0x10000).toString(16)}`
}
