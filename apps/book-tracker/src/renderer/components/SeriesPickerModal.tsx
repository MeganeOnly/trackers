// 「所属系列」选择器 —— BookDetail 加"设置系列"按钮触发(v1.7 新增)。
//
// 职责:弹一个紧凑的选择器,列出所有 series,让用户选一个作为所属系列。
// 候选规则(在 SeriesView 父组件的 useSeriesStore.getState().series):
// - 已存在的所有 series(按 id 升序)
// - 支持按 name 模糊搜索
// - **不在父组件截断** —— picker 自带搜索框过滤,列表 max-height + overflow-y 处理滚动
//
// **关键设计**:picker 选完不直接关,**提供「+ 新建系列」入口** —
// 用户选不到合适系列时,可以一键新建,无需先关 SeriesPickerModal → 打开
// AddModal「+ 系列」tab → 新建 → 关闭 → 再开 SeriesPickerModal 才能选到自己刚建的。
// **新建后自动选中** —— 用 useEffect 监听 series 列表长度变化
// 自动选最新一个 series。

import { useEffect, useRef, useState } from 'react'
import { useSeriesStore } from '../store/series'
import { Modal } from './Modal'

interface SeriesPickerModalProps {
  open: boolean
  onClose: () => void
  /** 选中候选 → 触发持久化(BookDetail 父组件 setSeries);空串视为取消 */
  onPick: (seriesId: string) => void
  /** 当前 book 的标题,给 picker title 用 */
  currentTitle: string
}

export function SeriesPickerModal({
  open,
  onClose,
  onPick,
  currentTitle
}: SeriesPickerModalProps): JSX.Element | null {
  const seriesList = useSeriesStore((s) => s.series)
  const loadSeries = useSeriesStore((s) => s.load)
  const createSeries = useSeriesStore((s) => s.create)
  const [query, setQuery] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [creatingError, setCreatingError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const newNameRef = useRef<HTMLInputElement | null>(null)
  // 跟踪上次见到 series 数,新建后自动选最新
  const lastSeriesCountRef = useRef<number>(seriesList.length)

  // 打开时确保 series 列表是最新的
  useEffect(() => {
    if (open && seriesList.length === 0) {
      void loadSeries()
    }
  }, [open, seriesList.length, loadSeries])

  // 打开 picker 时聚焦搜索框 + 清空 query
  useEffect(() => {
    if (open) {
      setQuery('')
      setCreating(false)
      setNewName('')
      setCreatingError(null)
      lastSeriesCountRef.current = seriesList.length
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // series 列表增长(新建成功)→ 自动选最新一个
  useEffect(() => {
    if (
      open &&
      seriesList.length > lastSeriesCountRef.current &&
      lastSeriesCountRef.current > 0
    ) {
      const newest = seriesList[seriesList.length - 1]
      if (newest) onPick(newest.id)
    }
    lastSeriesCountRef.current = seriesList.length
  }, [seriesList.length, open, onPick, seriesList])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const filtered = q
    ? seriesList.filter((s) => s.name.toLowerCase().includes(q))
    : seriesList

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) {
      setCreatingError('系列名不能为空')
      return
    }
    setCreatingError(null)
    try {
      await createSeries({ name: newName.trim(), notes: '' })
      // useEffect 会自动选最新
    } catch (e) {
      setCreatingError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="series-picker" role="dialog" aria-label="选择所属系列">
      <div className="series-picker-head">
        <span>《{currentTitle}》的所属系列</span>
        <button
          type="button"
          className="series-picker-close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
      <input
        ref={inputRef}
        className="series-picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索系列名..."
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <ul className="series-picker-list">
        {filtered.length === 0 ? (
          <li className="muted empty-hint">无匹配系列 —— 点下方「+ 新建系列」</li>
        ) : (
          filtered.map((s) => (
            <li
              key={s.id}
              className="series-picker-item"
              onClick={() => onPick(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPick(s.id)
                }
              }}
            >
              <span className="title">{s.name}</span>
              <span className="tracker-id muted">{s.id}</span>
            </li>
          ))
        )}
      </ul>
      <div className="series-picker-create">
        {creating ? (
          <div className="series-picker-create-form">
            <input
              ref={newNameRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新系列名"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleCreate()
                } else if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleCreate()}
            >
              创建
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setNewName('')
                setCreatingError(null)
              }}
            >
              取消
            </button>
            {creatingError && <span className="error">{creatingError}</span>}
          </div>
        ) : (
          <button
            type="button"
            className="series-picker-new"
            onClick={() => {
              setCreating(true)
              setNewName(query.trim()) // 复用搜索框内容
              requestAnimationFrame(() => newNameRef.current?.focus())
            }}
          >
            + 新建系列「{query.trim() || '新系列'}」
          </button>
        )}
      </div>
    </div>
  )
}