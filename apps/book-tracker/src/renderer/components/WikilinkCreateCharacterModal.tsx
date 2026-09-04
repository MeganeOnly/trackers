// 作品双链 `[[角色名]]` —— 断链创建新角色模态
//
// 触发:用户点击渲染后的 broken wikilink([[xxx]] 红色虚线下划线)。
// 行为:弹 Modal 让用户确认目标名(预填 wikilink 的 target),确认后:
//   1) 调 store.setCharacters(bookId, [...existing, newChar])
//   2) 回调 onCreated(newCharacterId) —— 父组件用此 id 调 navigateLocal 跳到新角色
//
// 不做 "直接跳到现有同名 character" 兜底:broken 语义就是「哪里都没找到」,
// 同名全局扫由 WikilinkText 自身在解析阶段处理,这里只负责"创建"。
// 若用户在别处先创建了同名角色(并发),新角色会重名 —— store 层不查重,
// 跟 CharactersPanel 的 add 行为保持一致。

import { useState } from 'react'
import { Modal } from '@ui/Modal'
import type { Book } from '@shared/types'
import { makeId } from '@shared/types'
import { useBooksStore } from '../store/books'

interface WikilinkCreateCharacterModalProps {
  /** 新角色名(预填) */
  target: string
  /** 把新角色加到哪本书 */
  bookId: string
  /** 全作品列表(给「+ 同时在另一部作品也建一条」扩展点;v1.7 不暴露) */
  allBooks: Book[]
  /** 创建完成回调 */
  onCreated: (characterId: string) => void
  onCancel: () => void
}

export function WikilinkCreateCharacterModal({
  target,
  bookId,
  onCreated,
  onCancel
}: WikilinkCreateCharacterModalProps): JSX.Element {
  const [name, setName] = useState<string>(target.trim())
  const setCharacters = useBooksStore((s) => s.setCharacters)
  const book = useBooksStore((s) => s.books.find((b) => b.id === bookId))

  const trimmed = name.trim()
  const canCreate = trimmed !== ''

  async function handleCreate(): Promise<void> {
    if (!canCreate || !book) return
    const newId = makeId()
    const now = Date.now()
    const next = [
      ...(book.characters ?? []),
      { id: newId, name: trimmed, notes: undefined, lastModified: now }
    ]
    try {
      await setCharacters(book.id, next)
      onCreated(newId)
    } catch (e) {
      // 错误保持模态打开,让用户重试或取消
      console.error('创建角色失败:', e)
      alert(`创建失败:${(e as Error).message}`)
    }
  }

  return (
    <Modal
      title="创建角色"
      onClose={onCancel}
      width={420}
      className="wikilink-create-modal"
    >
      <p className="muted wikilink-create-hint">
        「{target}」不存在 —— 给《{book?.title ?? '?'}》新增一个角色?
      </p>
      <label className="field">
        <span>角色名</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canCreate) {
              e.preventDefault()
              void handleCreate()
            }
          }}
          placeholder="角色名"
        />
      </label>
      <div className="wikilink-create-foot">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleCreate()}
          disabled={!canCreate}
        >
          创建
        </button>
      </div>
    </Modal>
  )
}
