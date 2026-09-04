// 角色笔记面板 —— BookDetail 的「角色笔记」区块
//
// 所有类型都能用（书 / 动画 / 电视剧 / 电影 / 其他）,不只是 tv/anime。
// 职责:
// - 列出所有角色（按添加顺序）;每行显示名字 + 笔记字数指示
// - 点击展开 → CharacterEditor（名字输入 + 笔记 textarea + 最后修改时间）
// - "+ 新增角色" 按钮
// - 删除整个角色（带 confirm）
//
// 状态:
// - expandedId: 当前展开的 character.id（null = 都没展开）
// - 笔记本地 draft:debounce 500ms 写盘
//
// 数据:
// - 角色笔记通过 book.characters 取（store 不再额外 selector —— Book 自带）
// - 所有变更走 store action setCharacters（整段替换,跟 setSeasons / setEpisodeStamps 同款）
//
// v1.5 lastModified 语义:
// - 用户主动 add / edit / remove character 时,组件构造新数组,
//   对"被改的那条"主动填 `lastModified = Date.now()`,其他保持原值
// - 仅删除整个 character 时,新数组里就不放那条了,无需刷时间戳
// - 用户点开 CharacterEditor 但什么都不改 → 不调 setCharacters → 老时间不变

import { useEffect, useRef, useState } from 'react'
import { useBooksStore } from '../store/books'
import { formatLastModified, makeId } from '@shared/types'
import type { Book, Character } from '@shared/types'
import { WikilinkText } from './WikilinkText'
import { useWikilinkTextarea } from './useWikilinkTextarea'

interface CharactersPanelProps {
  book: Book
}

const DEBOUNCE_MS = 500

export function CharactersPanel({ book }: CharactersPanelProps): JSX.Element {
  const characters = book.characters ?? []
  const setCharacters = useBooksStore((s) => s.setCharacters)
  // v1.7 wikilink —— 监听 store.navigateToCharacter(bookId, characterId),
  // 跨组件触发展开:wikilink 点击 resolved-local 时由 Provider 写入这里消费。
  const navigateToCharacter = useBooksStore((s) => s.navigateToCharacter)
  const setNavigateToCharacter = useBooksStore((s) => s.setNavigateToCharacter)
  // 全作品列表(给 wikilink 预览解析跨作品用)—— 订阅保证 books 变化时重渲染
  const allBooks = useBooksStore((s) => s.books)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  // book.id 切换时收起展开区
  useEffect(() => {
    setExpandedId(null)
  }, [book.id])

  // v1.7 wikilink —— 跨组件跳转落地:匹配当前 book 时展开目标 character,
  // 然后清回 null(避免二次触发;同条 trigger 重设也只会触发一次 effect)。
  useEffect(() => {
    if (navigateToCharacter && navigateToCharacter.bookId === book.id) {
      setExpandedId(navigateToCharacter.characterId)
      // 立即清,让下一次跳转(同 character 再次点击 / 跳别的)能再触发
      setNavigateToCharacter(null)
    }
  }, [navigateToCharacter, book.id, setNavigateToCharacter])

  /** 新增一空角色(只填名字 + 时间戳,笔记留空) */
  async function handleAdd(): Promise<void> {
    const now = Date.now()
    const next: Character[] = [
      ...characters,
      { id: makeId(), name: '', notes: undefined, lastModified: now }
    ]
    await setCharacters(book.id, next)
    setExpandedId(next[next.length - 1].id)
  }

  /** 更新指定角色的部分字段(name 或 notes);刷该角色 lastModified */
  async function handleUpdate(id: string, patch: Partial<Pick<Character, 'name' | 'notes'>>): Promise<void> {
    const next = characters.map((c) =>
      c.id === id ? { ...c, ...patch, lastModified: Date.now() } : c
    )
    await setCharacters(book.id, next)
  }

  /** 删除整个角色(无需刷时间戳——条目从数组里消失) */
  async function handleRemove(id: string): Promise<void> {
    const target = characters.find((c) => c.id === id)
    if (!target) return
    if (!confirm(`删除角色「${target.name || '(未命名)'}」?该角色的笔记会从文件里清除。`)) return
    const next = characters.filter((c) => c.id !== id)
    await setCharacters(book.id, next)
    if (expandedId === id) setExpandedId(null)
  }

  return (
    <section className="characters-panel">
      <h3 className="characters-panel-title">
        角色笔记
        <span className="muted characters-count">
          {characters.length > 0 ? `(${characters.length})` : ''}
        </span>
      </h3>
      {characters.length === 0 ? (
        <p className="muted characters-empty">
          还没有角色 —— 点下方「+ 新增角色」加一条,用来给人物 / 主角 / 配角 / 组织写笔记。
        </p>
      ) : (
        <div className="characters-list">
          {characters.map((c) => (
            <CharacterRow
              key={c.id}
              character={c}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
              onUpdate={(patch) => void handleUpdate(c.id, patch)}
              onRemove={() => void handleRemove(c.id)}
              allBooks={allBooks}
              currentBook={book}
            />
          ))}
        </div>
      )}
      <button type="button" className="character-add" onClick={() => void handleAdd()}>
        + 新增角色
      </button>
    </section>
  )
}

// ==================== 子组件:CharacterRow ====================

interface CharacterRowProps {
  character: Character
  expanded: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<Pick<Character, 'name' | 'notes'>>) => void
  onRemove: () => void
  /** v1.7 wikilink —— 当前 book 的全作品(预览跨作品解析用) */
  allBooks: Book[]
  /** 当前 book(wikilink local 解析用;CharacterPanel 一本书渲染一次) */
  currentBook: Book
}

function CharacterRow({
  character,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
  allBooks,
  currentBook
}: CharacterRowProps): JSX.Element {
  const displayName = character.name.trim() || '(未命名)'
  const noteLen = character.notes?.length ?? 0
  const hasNote = noteLen > 0

  return (
    <div className={`character-row${expanded ? ' expanded' : ''}${hasNote ? ' has-note' : ''}`}>
      <button type="button" className="character-row-head" onClick={onToggle}>
        <span className="character-row-name">{displayName}</span>
        {hasNote && (
          <span className="character-row-note-mark" title={`笔记 ${noteLen} 字`}>
            📝
          </span>
        )}
        {character.lastModified !== undefined && (
          <span className="character-row-mod muted">
            {formatLastModified(character.lastModified)}
          </span>
        )}
        <span className="character-row-toggle">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <CharacterEditor
          character={character}
          onUpdate={onUpdate}
          onRemove={onRemove}
          currentBook={currentBook}
          allBooks={allBooks}
        />
      )}
    </div>
  )
}

// ==================== 子组件:CharacterEditor ====================

interface CharacterEditorProps {
  character: Character
  onUpdate: (patch: Partial<Pick<Character, 'name' | 'notes'>>) => void
  onRemove: () => void
  /** v1.7 wikilink —— 当前 book,`[[` 触发 picker 用 */
  currentBook: Book
  /** v1.7 wikilink —— 全作品列表(预览跨作品解析用) */
  allBooks: Book[]
}

/**
 * 角色编辑区:名字输入(blur 即写) + 笔记 textarea(debounce 500ms 写)。
 * 时间戳由 store 层自动 inject(在 handleUpdate 里 Date.now()),组件不感知。
 * v1.7 wikilink:textarea 集成 `[[` 触发 picker + 下方渲染预览(可点击 wikilink)。
 */
function CharacterEditor({
  character,
  onUpdate,
  onRemove,
  currentBook,
  allBooks
}: CharacterEditorProps): JSX.Element {
  const [nameDraft, setNameDraft] = useState<string>(character.name)
  const [noteDraft, setNoteDraft] = useState<string>(character.notes ?? '')
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // record 变化(外部 store 更新) → 同步本地 draft(避免覆盖用户正在敲的内容)
  useEffect(() => {
    setNameDraft(character.name)
  }, [character.name])
  useEffect(() => {
    setNoteDraft(character.notes ?? '')
  }, [character.notes])

  // v1.7 wikilink —— `[[` 触发 picker;book 由 CharacterRow 透传。
  // 这里 useWikilinkTextarea 替换原 textarea 的 onChange,
  // 在 `[[` 检测到时打开 picker 并插入 `[[name]]`,其他输入照常透传。
  const { handleChange: handleNoteChange, taRef: noteTaRef } = useWikilinkTextarea({
    book: currentBook,
    value: noteDraft,
    setValue: (v) => {
      setNoteDraft(v)
      scheduleNoteFlush()
    }
  })

  function flushName(): void {
    const trimmed = nameDraft.trim()
    // 空名字 → 不写(name 空会被 IPC 前端过滤掉;这里就保留原始 draft 让用户看清)
    if (trimmed === character.name.trim()) return
    onUpdate({ name: nameDraft }) // 保留原始空格版(用户可能就想用带空格的名字)
  }
  function flushNote(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    const trimmed = noteDraft.trim()
    if (trimmed === (character.notes ?? '').trim()) return
    // 笔记空串 → undefined(后端会兜底"不写盘,保留 character";前端语义保持 undefined)
    onUpdate({ notes: trimmed === '' ? undefined : noteDraft })
  }
  function scheduleNoteFlush(): void {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(flushNote, DEBOUNCE_MS)
  }

  return (
    <div className="character-editor">
      <label className="field">
        <span>角色名</span>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={flushName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          placeholder="如：高育良 / 贾宝玉 / Neo"
        />
      </label>
      <label className="field">
        <span>角色笔记</span>
        <textarea
          ref={noteTaRef}
          value={noteDraft}
          onChange={handleNoteChange}
          onBlur={flushNote}
          rows={6}
          placeholder="自由写 —— 人物小传 / 关系网 / 名场面 / 心理活动(输入 [[ 触发角色选择;空 = 删除此条笔记)"
        />
      </label>
      {/* v1.7 wikilink 预览 —— 解析 notes 里的 [[xxx]] 成可点击链接 */}
      <WikilinkText
        text={noteDraft}
        currentBook={currentBook}
        allBooks={allBooks}
        className="wikilink-preview-block"
      />
      <div className="character-editor-foot">
        <button type="button" className="btn-danger character-delete" onClick={onRemove}>
          删除该角色
        </button>
        {character.lastModified !== undefined && (
          <span className="muted">
            最后修改：{formatLastModified(character.lastModified)}
          </span>
        )}
      </div>
    </div>
  )
}
