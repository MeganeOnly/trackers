// 「下一季」选择器 —— BookDetail 加"下一季"按钮触发
//
// 职责:弹一个紧凑的选择器,列出所有非当前 book 的候选,让用户选一部作为下一季。
// 候选规则(在 BookDetail 父组件的 `candidates` useMemo 里实现):
// - 排除自己(self-loop 禁止)
// - 推荐按 kind === 'tv' | 'anime' 优先,但不硬约束(允许跨类型)
// - 按 title 模糊搜索
//
// 实现参考:PrereqEditor.tsx 的 picker 模式(行 351-373)。本组件是受控的:
// 父组件提供 open / onClose / candidates,自己只管搜索 query 和选中回调。
//
// v1.6 新增 —— 用户报告"没有实际增添下一季的地方,没办法让我点击后让我能够选择下一季是哪个作品"

import { useEffect, useRef, useState } from 'react'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book } from '@shared/types'

interface NextSeasonPickerProps {
  /** 是否打开 picker(受控) */
  open: boolean
  /** 关闭 picker(选中 / 取消 / 点外部 都调) */
  onClose: () => void
  /** 候选作品列表(已排除自己;按 kind 优先级 + title 升序排好;**全量**,
   *  不在父组件截断 —— picker 自带搜索框负责按 title / author 过滤,
   *  列表 max-height + overflow-y 处理滚动) */
  candidates: Book[]
  /** 选中候选 → 触发持久化(BookDetail 父组件 setNextSeason);空串视为取消 */
  onPick: (id: string) => void
  /** 当前 book 的标题,给 picker title 用 */
  currentTitle: string
}

export function NextSeasonPicker({
  open,
  onClose,
  candidates,
  onPick,
  currentTitle
}: NextSeasonPickerProps): JSX.Element | null {
  const [query, setQuery] = useState<string>('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开时自动聚焦搜索框 + 清空旧 query
  useEffect(() => {
    if (open) {
      setQuery('')
      // requestAnimationFrame 等 DOM 渲染完再聚焦
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? candidates.filter(
        (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
      )
    : candidates

  return (
    <div className="next-season-picker" role="dialog" aria-label="选择下一季">
      <div className="next-season-picker-head">
        <span>《{currentTitle}》的下一季</span>
        <button
          type="button"
          className="next-season-picker-close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
      <input
        ref={inputRef}
        className="next-season-picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索作品名 / 作者..."
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <ul className="next-season-picker-list">
        {filtered.length === 0 ? (
          <li className="muted empty-hint">无匹配 —— 先在加作品表单加新作品吧</li>
        ) : (
          filtered.map((b) => (
            <li
              key={b.id}
              className={`next-season-picker-item kind-${b.kind}`}
              onClick={() => onPick(b.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick(b.id)
                }
              }}
            >
              <span className={`kind-tag kind-${b.kind}`}>{WORK_KIND_LABELS[b.kind]}</span>
              <span className="title">{b.title}</span>
              <span className="author muted">{b.author}</span>
              <span className="tracker-id muted">{b.id}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}