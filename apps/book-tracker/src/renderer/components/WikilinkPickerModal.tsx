// 作品双链 `[[角色名]]` —— Picker 模态
//
// 两种触发场景(都复用本组件):
// 1. **`[[` 输入触发**:候选 = 当前作品的 character 列表;showCreate=true;
//    用户选已有 → 父组件插入 `[[name]]` 到 textarea;用户创建新 → 父组件调 create modal。
// 2. **点击 global-multi wikilink 触发**:候选 = 全作品同名 character;showCreate=false;
//    用户选一条 → 父组件跳转到该 character(bookId + characterId)。
//
// 行为:
// - 输入框实时过滤 candidates(中文 includes / 英文 toLowerCase().includes)
// - ↑↓ 切换高亮、Enter 选当前高亮 / 没高亮时若 input 非空走 create、Esc 关闭
// - "+ 创建新角色" 按钮:input 非空时 enabled,点击走 onCreate(input.value.trim())
//
// 视觉参考:NextSeasonPicker(同样的紧凑搜索 + 列表模式),但本组件用 Modal 基座 +
// 自定义 footer 而非 inline panel —— 因为这是全局唯一模态。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@ui/Modal'
import type { WikilinkCandidate } from '@shared/wikilink'

interface WikilinkPickerModalProps {
  /** 候选(已有 character);空数组时只允许 create(若 showCreate) */
  candidates: WikilinkCandidate[]
  /** 触发 picker 时已输入的搜索词(由 `[[` 触发时的 textarea 光标位置提取) */
  initialName: string
  /** 是否显示「+ 创建新角色」入口(local picker 用,global picker 不用) */
  showCreate: boolean
  /** 用户从候选中点 / Enter 高亮 → 返回该 candidate(始终非 null) */
  onPick: (candidate: WikilinkCandidate) => void
  /** 用户点「+ 创建新角色」/ 无高亮 + input 非空 + Enter → 调 onCreate(name) */
  onCreate: (name: string) => void
  onClose: () => void
}

export function WikilinkPickerModal({
  candidates,
  initialName,
  showCreate,
  onPick,
  onCreate,
  onClose
}: WikilinkPickerModalProps): JSX.Element {
  const [query, setQuery] = useState<string>(initialName)
  const [highlight, setHighlight] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // 打开时自动聚焦搜索框 + 清掉 query(沿用 NextSeasonPicker 的做法)
  useEffect(() => {
    setQuery(initialName)
    setHighlight(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 实时过滤 —— 中文 includes / 英文 toLowerCase().includes
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return candidates
    return candidates.filter((c) => c.character.name.toLowerCase().includes(q))
  }, [query, candidates])

  // query 变化 → 高亮归零;filtered 缩短时也要 clamp
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1))
  }, [filtered.length, highlight])

  // 高亮变化 → 滚动到可见
  useEffect(() => {
    const ul = listRef.current
    if (!ul) return
    const item = ul.querySelector<HTMLElement>(`[data-hl="${highlight}"]`)
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function commit(): void {
    if (filtered.length > 0) {
      onPick(filtered[highlight])
      return
    }
    if (showCreate) {
      const name = query.trim()
      if (name !== '') onCreate(name)
    }
  }

  const createLabel = `+ 创建新角色「${query.trim()}」`
  const canCreate = showCreate && query.trim() !== ''

  return (
    <Modal
      title={showCreate ? '选择角色或新建' : '选择角色'}
      onClose={onClose}
      width={420}
      className="wikilink-picker-modal"
    >
      <input
        ref={inputRef}
        className="wikilink-picker-search"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setHighlight(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => (h + 1) % Math.max(filtered.length, 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => (h - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={showCreate ? '搜索已有角色或输入新角色名' : '搜索角色...'}
      />
      <ul ref={listRef} className="wikilink-picker-list">
        {filtered.length === 0 ? (
          <li className="muted wikilink-picker-empty">
            {showCreate
              ? query.trim() !== ''
                ? '无匹配 —— 按 Enter 或点下方按钮创建'
                : '还没有角色 —— 输入名字创建'
              : '无匹配'}
          </li>
        ) : (
          filtered.map((c, idx) => (
            <li
              key={`${c.sourceBook.id}-${c.character.id}`}
              data-hl={idx}
              className={`wikilink-picker-item${idx === highlight ? ' hl' : ''}`}
              onClick={() => onPick(c)}
              onMouseEnter={() => setHighlight(idx)}
            >
              <span className="wikilink-picker-item-name">{c.character.name}</span>
              <span className="wikilink-picker-item-source muted">
                {showCreate ? '' : `《${c.sourceBook.title}》`}
              </span>
            </li>
          ))
        )}
      </ul>
      {showCreate && (
        <div className="wikilink-picker-foot">
          <button
            type="button"
            className="wikilink-picker-create"
            disabled={!canCreate}
            onClick={() => onCreate(query.trim())}
          >
            {createLabel}
          </button>
        </div>
      )}
    </Modal>
  )
}
