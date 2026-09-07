// 作品笔记聚合 Modal(v2.x 新增)
//
// 用途:日常模式(CleanMode)点击作品时打开,聚合该作品的笔记相关功能:
// - 主笔记(Book.notes)—— 预览 / 编辑二态 + wikilink `[[]]` 支持
// - 集笔记(EpisodesPanel)—— tv/anime 才显示
// - 角色笔记(CharactersPanel)—— 所有类型都显示
//
// 设计要点:
// - 与 GraphModal 同款 Modal 容器,通过 props 控制 onClose / 标题
// - 主笔记独立保存:走 booksStore.update(id, { notes }) patch,
//   **不**触发 BookDetail 的「整本保存」逻辑,避免覆盖编辑模式未保存状态
// - 标题显示作品名 + 类型 tag,宽度 920 / 高度 85vh(适合笔记编辑,跟 GraphModal 同款)
// - 复用 EpisodesPanel / CharactersPanel / WikilinkText / useWikilinkTextarea,
//   **不**自己实现面板逻辑(避免状态双写 + wikilink 行为分叉)
//
// 不进入的地方:
// - 前置依赖(PrereqEditor)—— 属于"结构关联"而非"笔记",仍留在 BookDetail
// - 「上一季 / 下一季 / 所属系列」—— 属于"作品间跳转"而非"笔记",仍留在 BookDetail
// - 状态切换 / 进度调整 / 进度条—— 属于"管理操作"而非"笔记",仍留在 BookDetail
// - 删除作品—— 同上,留 BookDetail

import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { EpisodesPanel } from './EpisodesPanel'
import { CharactersPanel } from './CharactersPanel'
import { WikilinkText } from './WikilinkText'
import { useWikilinkTextarea } from './useWikilinkTextarea'
import { useBooksStore } from '../store/books'
import { WORK_KIND_LABELS } from '@shared/types'

interface BookNotesModalProps {
  /** 当前打开 modal 的作品 id;App 层持有并控制 mount/unmount */
  bookId: string
  onClose: () => void
}

const MODAL_WIDTH = 920

/** 主笔记本地保存状态:`idle` 默认 / `saving` 提交中 / `saved` 成功并短暂显示后回到 idle / `error` 失败(按钮变 "保存失败 — 重试",textarea 内容保留) */
type NotesSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 作品笔记 Modal 容器
 *
 * 主笔记行为细节:
 * - 进入 modal 时从 book.notes 初始化本地 draft
 * - 「笔记」标题可点击切到 textarea 编辑态(跟 BookDetail 的 note-field-toggle 同款交互)
 * - 「保存笔记」按钮显式提交:走 `update(bookId, { notes })`,只 patch notes 一项,
 *   **不**触发 BookDetail 的整本保存逻辑
 * - v2.x:对称 BookDetail.notesDirty 保护 —— 外部 store.notes 更新(如 BookDetail
 *   整本保存 / 其他路径)只在本地未编辑时同步刷新本地 draft;本地有未保存输入时
 *   保留本地草稿,避免外部保存吞掉用户在 Modal 里的输入
 * - 保存成功后保留 noteEditing=true 短暂显示「已保存」反馈,1.5s 后再切回预览
 *   —— 立即 setNoteEditing(false) 会让按钮所在 section 立刻消失,反馈看不见
 *
 * v2.x「按删除键就会出问题」类 bug 修复(book-tracker §10 经验沉淀):
 * - **关闭未保存拦截**:× / backdrop / Esc 关闭路径都过 `handleClose`,
 *   有 hasUnsavedChanges 时 `window.confirm('主笔记有未保存修改,确定关闭?')`,
 *   用户取消则不关闭。Modal Esc 在 editable 元素内已经不会主动关闭
 *   (Modal.tsx),这条兜底 × / backdrop 两路。
 * - **beforeunload 监听**:hasUnsavedChanges 时挂 `window.addEventListener('beforeunload', ...)`,
 *   `e.preventDefault() + e.returnValue = ''`(现代浏览器只认这个组合,
 *   return-only 不行,见 docs/dev-notes.md 2026-09 §X)。
 *   防止用户用 Alt+F4 / Tauri 关闭按钮 / 刷新 dev 页面 直接关 app 时静默丢数据。
 * - **in-flight IPC 防护**:用 `inFlightRef` 跟踪正在进行的 update Promise。
 *   关闭时若 IPC 未完成,**不立即 unmount**(延迟到 IPC resolve),避免 React 18
 *   在 unmount 组件上 setState 的 silent drop + 用户不知 save 是否成功。
 *   IPC 失败时 `saveStatus='error'` 留在 textarea 旁边显示错误,textarea 内容 + dirty
 *   状态保留,用户可重试点保存按钮。
 */
export function BookNotesModal({ bookId, onClose }: BookNotesModalProps): JSX.Element {
  // 从 store 实时订阅 —— book 被删除 / 字段被外部更新都能反映
  const book = useBooksStore((s) => s.books.find((b) => b.id === bookId))
  const allBooks = useBooksStore((s) => s.books)
  const update = useBooksStore((s) => s.update)

  // 主笔记本地 draft + 预览/编辑二态
  const [notes, setNotes] = useState<string>(book?.notes ?? '')
  const [noteEditing, setNoteEditing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<NotesSaveStatus>('idle')
  // in-flight IPC 引用 —— 关闭路径上等待其完成,避免 unmount 组件上 setState 的 silent drop
  const inFlightRef = useRef<Promise<unknown> | null>(null)
  // v2.x:notesDirty 跟踪 —— 与 BookDetail.notesDirty 严格对称(同名同语义):
  // - dirty=false:本地草稿未动 → store 更新可同步刷新本地
  // - dirty=true :本地有用户未保存输入 → 禁止 useEffect 覆盖本地草稿,
  //   避免 BookDetail 整本保存吞掉用户在 Modal 里未保存的输入
  const [notesDirty, setNotesDirty] = useState(false)

  // v2.x:setNotesWithDirty —— useCallback 包装,用户改 textarea / wikilink 插入
  // 时调用,同步 setNotes + setNotesDirty(true),保证后续 store 更新不会覆盖本地草稿
  const setNotesWithDirty = useCallback((v: string): void => {
    setNotes(v)
    setNotesDirty(true)
  }, [])

  // 同步外部 book.notes / bookId 变化到本地 draft:
  // - **bookId 切换**(切到另一部作品) → 强制重置 notes / noteEditing / saveStatus /
  //   notesDirty。即使 notesDirty=true 也要重置 —— 本地草稿属于旧作品,
  //   切到新作品后保留无意义,会和 store 的 notes 状态错位。用 prevBookIdRef
  //   记录上一次 bookId 检测切换。
  // - **同一作品** book?.notes 被外部更新 → 仅在 !notesDirty 时同步刷新本地
  //   notes;dirty=true 时保护草稿(严格对称 BookDetail.useEffect([book?.notes])
  //   的保护:防止外部整本保存在 Modal 端还有未保存草稿时覆盖本地)。
  //   此分支**不**重置 noteEditing / saveStatus:可能正处保存后的 saved 反馈
  //   窗口(1.5s timeout),重置会吞掉「已保存」反馈;也避免用户刚点进编辑态
  //   还没敲字时被外部更新强关编辑。
  //
  // **关键**:notesDirty **不**放进依赖数组。handleSaveNotes 末尾的
  // setNotesDirty(false) 不应触发此 effect —— 否则会立刻把 saveStatus 重置
  // idle、noteEditing 关闭,「已保存」反馈窗口(1.5s timeout)被吞掉,按钮
  // 所在 section 瞬间消失,反馈看不见。effect 跑时通过闭包读取渲染时刻的
  // notesDirty(渲染→commit→effect 在同一 microtask,闭包值即最新值)。
  const prevBookIdRef = useRef(bookId)
  useEffect(() => {
    if (prevBookIdRef.current !== bookId) {
      // 切到另一部作品 —— 强制重置,本地草稿已无意义
      prevBookIdRef.current = bookId
      setNotes(book?.notes ?? '')
      setNoteEditing(false)
      setSaveStatus('idle')
      setNotesDirty(false)
      return
    }
    // 同一作品,book?.notes 被外部更新
    if (notesDirty) return // dirty=true 保护草稿
    // dirty=false 同步本地 notes(不重置 noteEditing / saveStatus,见上方注释)
    setNotes(book?.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notesDirty 故意不放进依赖(见上方注释)
  }, [bookId, book?.notes])

  // wikilink hook —— `[[` 触发全局 picker 插入 `[[name]]`,光标落到 `]]` 之后
  // book 可能 undefined(被删除);hook 内部判空,handleChange 退化为透传 setValue
  // v2.x:setValue 用 setNotesWithDirty 替代 setNotes,让 wikilink 插入也触发 dirty 标记
  const { handleChange: handleNotesChange, taRef: notesTaRef } = useWikilinkTextarea({
    book,
    value: notes,
    setValue: setNotesWithDirty
  })

  // book 被删除 —— 渲染降级提示,不崩溃
  if (!book) {
    return (
      <Modal
        title="作品笔记"
        onClose={onClose}
        width={MODAL_WIDTH}
        className="modal-card--notes"
      >
        <div className="book-notes-missing">
          <p className="muted">该作品已被删除 —— 无法查看笔记。</p>
        </div>
      </Modal>
    )
  }
  const cur = book

  // 主笔记是否有未保存改动(用于启用 / 禁用保存按钮 + 关闭前判断)——
  // 用 useState 跟踪的 notesDirty(用户改过本地 draft);严格说
  // `notesDirty && notes !== cur.notes` 更精确,但 setNotesWithDirty 永远
  // 同时改两者,实践中二者等价;保留 tracked dirty 让按钮状态与 effect gate
  // 来源一致,语义统一。
  const hasUnsavedChanges = notesDirty && notes !== cur.notes

  /** 显式保存主笔记 —— 走 booksStore.update patch notes 单字段 */
  async function handleSaveNotes(): Promise<void> {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    // v2.x:把 in-flight Promise 存到 ref,关闭路径上 await 它(避免 unmount 后 setState)
    const p = update(cur.id, { notes }).catch((e) => {
      console.error('save notes failed:', e)
      setSaveStatus('error')
      // 出错时保留 textarea 内容 + dirty,textarea 旁边显示错误,用户可重试
    })
    inFlightRef.current = p
    try {
      await p
      setSaveStatus('saved')
      // v2.x:保存成功后本地 draft 已写盘 → 重置 dirty,允许后续外部 notes 更新同步回来。
      // setNotesDirty(false) **不**会触发同步 effect(notesDirty 故意不放进依赖,
      // 见上面 useEffect 注释),因此 saved 状态 + noteEditing=true 一直保留到
      // 下面的 1.5s timeout 触发为止,「已保存」反馈窗口不被吞掉。
      setNotesDirty(false)
      // 1.5s 后回到 idle + 切回预览态 —— 短暂显示「已保存」反馈
      // 注意:必须先保留 noteEditing=true,让按钮所在 section 继续渲染;
      // 否则立即 setNoteEditing(false) 会让按钮瞬间消失,「已保存」反馈看不见。
      window.setTimeout(() => {
        setSaveStatus((s) => (s === 'saved' ? 'idle' : s))
        setNoteEditing(false)
      }, 1500)
    } finally {
      if (inFlightRef.current === p) inFlightRef.current = null
    }
  }

  /**
   * 关闭路径统一入口:× / backdrop / Modal-onClose 全部走这里。
   * 有未保存改动 → window.confirm 拦截(用户选取消则不关闭)。
   * 同时:若 in-flight IPC 还在跑,await 它完成再关闭,避免 unmount 组件上 setState
   * 的 silent drop,以及用户看不到保存结果。
   */
  const handleClose = useCallback((): void => {
    if (hasUnsavedChanges) {
      const ok = window.confirm('主笔记有未保存修改,确定关闭?')
      if (!ok) return
    }
    // 在 unmount 之前等 IPC 完成 —— 重要:用户点 × 关闭后看到笔记被保存,
    // 不然 IPC 在 unmount 组件上 resolve 时 setState 会 silent drop。
    if (inFlightRef.current) {
      void inFlightRef.current.finally(() => {
        // 等 IPC 完成后再调 onClose(unmount BookNotesModal)
        onClose()
      })
    } else {
      onClose()
    }
  }, [hasUnsavedChanges, onClose])

  /**
   * beforeunload 监听:防止用户 Alt+F4 / 关 Tauri 窗口 / 刷新 dev 页面时
   * 未保存笔记静默丢失。hasUnsavedChanges 时挂上,变 false 时摘下。
   *
   * 现代浏览器(Chrome 119+ / Firefox / Safari)只认 `preventDefault() + returnValue = ''`,
   * return-only 是 no-op。Message 文案浏览器会忽略(规范要求),只显示通用提示。
   */
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedChanges])

  return (
    <Modal
      title={`笔记 · ${cur.title}`}
      onClose={handleClose}
      width={MODAL_WIDTH}
      className="modal-card--notes"
    >
      {/* 顶部作品头:kind tag + 标题 + 作者(只读,确认打开的是哪本) */}
      <header className="book-notes-header">
        <span className={`kind-tag kind-${cur.kind}`}>{WORK_KIND_LABELS[cur.kind]}</span>
        <span className="book-notes-title">{cur.title}</span>
        {cur.author && <span className="book-notes-author muted">· {cur.author}</span>}
        <span className="book-notes-id muted">#{cur.id}</span>
      </header>

      {/* 主笔记 —— 默认预览,点击切到编辑态 */}
      <section className="book-notes-section book-notes-main">
        <div className="book-notes-section-head">
          <span
            className={`note-field-toggle${noteEditing ? ' is-editing' : ''}`}
            role="button"
            tabIndex={0}
            title={
              noteEditing
                ? '编辑中 —— 点「保存笔记」或关闭 modal 时不会自动保存'
                : '点击进入编辑'
            }
            onClick={() => {
              if (!noteEditing) setNoteEditing(true)
            }}
            onKeyDown={(e) => {
              if (!noteEditing && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                setNoteEditing(true)
              }
            }}
          >
            主笔记
            {!noteEditing && <span className="note-field-edit-hint">点击编辑</span>}
          </span>
          {noteEditing && (
            <div className="book-notes-section-actions">
              {hasUnsavedChanges && <span className="muted book-notes-dirty">未保存</span>}
              <button
                type="button"
                className="btn-primary book-notes-save"
                onClick={() => void handleSaveNotes()}
                disabled={!hasUnsavedChanges || saveStatus === 'saving'}
              >
                {saveStatus === 'saving'
                  ? '保存中…'
                  : saveStatus === 'saved'
                    ? '已保存'
                    : saveStatus === 'error'
                      ? '保存失败 — 重试'
                      : '保存笔记'}
              </button>
            </div>
          )}
        </div>
        {noteEditing ? (
          <textarea
            ref={notesTaRef}
            className="book-notes-textarea"
            value={notes}
            onChange={handleNotesChange}
            onKeyDown={(e) => {
              // Esc 退出编辑(不保存;避免误触)
              if (e.key === 'Escape') {
                e.preventDefault()
                ;(e.currentTarget as HTMLTextAreaElement).blur()
                setNoteEditing(false)
              }
            }}
            rows={8}
            autoFocus
            placeholder="自由写 —— 心得 / 摘录 / 备忘(输入 [[ 触发角色选择)"
          />
        ) : (
          <WikilinkText
            text={notes}
            currentBook={cur}
            allBooks={allBooks}
            className="wikilink-preview-block"
          />
        )}
        <p className="muted book-notes-hint">
          提示:主笔记独立保存,不会影响编辑模式整本保存按钮的其它字段。
        </p>
      </section>

      {/* 集笔记 —— tv/anime 才显示(沿用 EpisodesPanel 全部能力:季结构 / 单集笔记 / 时间戳) */}
      {(cur.kind === 'tv' || cur.kind === 'anime') && (
        <section className="book-notes-section">
          <EpisodesPanel book={cur} />
        </section>
      )}

      {/* 角色笔记 —— 所有类型都显示(CharactersPanel 内已带所有笔记能力) */}
      <section className="book-notes-section">
        <CharactersPanel book={cur} />
      </section>
    </Modal>
  )
}
