// 「批量加入系列」picker body(无 Modal 包装)—— 由 SeriesView 在 view === 'picker' 时渲染。
//
// **职责**:多选候选作品列表 → 批量调用 setSeries 加入当前 series。
// **为什么抽出来**:与 SeriesDetailBody 同款 —— 全部在 AddModal 内(view 状态机切换),
// 严禁 Modal 嵌套(v1.8 反模式)。
//
// **候选规则**:
// - 全部 books(`useBooksStore.books`)
// - **过滤掉已经在该系列里的**(避免重复添加)
// - **不过滤已经在其他系列里的** —— 业务上允许一本书只能属于一个系列(单向引用),
//   加入新系列会替换旧引用,前端在点击「加入系列」时 confirm 提示即可
//
// **多选交互**:checkbox-style 多选,空集合时「加入系列」按钮 disabled
// **筛选**:按 title / author / id 模糊搜索(同 NextSeasonPicker 模式)
// **批量提交**:由父组件 SeriesView.handlePickConfirm 串行 for-loop 调 setSeries,
// 部分失败 alert 列出失败清单(不全部回滚 —— 用户能精确看到哪本失败),
// 全部成功 → 切回 detail;全部失败 → 留 picker 让用户调整。

import { useEffect, useMemo, useRef, useState } from 'react'
import { WORK_KIND_LABELS } from '@shared/types'
import type { Book, Series } from '@shared/types'

interface SeriesPickBooksBodyProps {
  series: Series
  books: Book[]
  onBack: () => void
  /** 父组件包装:批量调 setSeries;内部处理成功/部分失败/全部失败 UI 反馈 */
  onConfirm: (selectedIds: string[]) => Promise<void>
  /** 批量提交进行中(灰掉全部按钮) */
  busy: boolean
}

export function SeriesPickBooksBody({
  series,
  books,
  onBack,
  onConfirm,
  busy
}: SeriesPickBooksBodyProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开时聚焦搜索框 + 清空旧状态
  useEffect(() => {
    setQuery('')
    setPicked(new Set())
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [series.id])

  // 候选:全部 books - 当前 series 的成员
  const candidates = useMemo(() => {
    return books.filter((b) => b.seriesId !== series.id)
  }, [books, series.id])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return candidates
    return candidates.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
    )
  }, [candidates, q])

  function togglePick(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePickAll(): void {
    if (picked.size === filtered.length) {
      // 全部已选 → 全取消
      setPicked(new Set())
    } else {
      // 全选当前 filtered
      setPicked(new Set(filtered.map((b) => b.id)))
    }
  }

  async function handleConfirm(): Promise<void> {
    if (picked.size === 0) return
    const ids = Array.from(picked)
    // 提示用户:这些书可能之前在别的系列里,加入会替换旧引用
    const movingFromOtherSeries = ids.some((id) => {
      const b = books.find((x) => x.id === id)
      return b?.seriesId && b.seriesId !== series.id
    })
    if (movingFromOtherSeries) {
      const ok = confirm(
        `选中的作品中有部分已属于其他系列,加入「${series.name}」会替换它们的旧引用。\n\n继续?`
      )
      if (!ok) return
    }
    await onConfirm(ids)
    // onConfirm 成功后父组件会切走 view;若失败父组件保留 view 让用户调整
  }

  const allFilteredSelected =
    filtered.length > 0 && picked.size === filtered.length

  return (
    <div className="series-picker-body">
      <div className="series-picker-head">
        <button
          type="button"
          className="series-detail-back"
          onClick={onBack}
          title="返回系列详情"
          disabled={busy}
        >
          ← 返回
        </button>
        <span className="series-picker-title">
          添加作品到「{series.name}」
        </span>
      </div>

      <input
        ref={inputRef}
        className="series-picker-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索作品名 / 作者 / ID..."
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onBack()
          }
        }}
      />

      {candidates.length === 0 ? (
        <p className="muted empty-hint">
          所有作品都已在「{series.name}」中 —— 没有可添加的候选
        </p>
      ) : (
        <>
          <div className="series-picker-toolbar">
            <label className="series-picker-toggle-all">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={togglePickAll}
                disabled={busy || filtered.length === 0}
              />
              <span>
                {allFilteredSelected ? '取消全选' : '全选当前筛选'}
                {' '}
                <span className="muted">
                  ({filtered.length} 个候选{query && `,搜索 "${query}"`})
                </span>
              </span>
            </label>
          </div>
          <ul className="series-picker-list">
            {filtered.length === 0 ? (
              <li className="muted empty-hint">无匹配作品</li>
            ) : (
              filtered.map((b) => (
                <li
                  key={b.id}
                  className={`series-picker-row kind-${b.kind}`}
                  onClick={() => !busy && togglePick(b.id)}
                  role="button"
                  tabIndex={busy ? -1 : 0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !busy) {
                      e.preventDefault()
                      togglePick(b.id)
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(b.id)}
                    onChange={() => togglePick(b.id)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={busy}
                  />
                  <span className={`kind-tag kind-${b.kind}`}>
                    {WORK_KIND_LABELS[b.kind]}
                  </span>
                  <span className="title">{b.title}</span>
                  <span className="author muted">{b.author}</span>
                  <span className="tracker-id muted">{b.id}</span>
                  {b.seriesId && b.seriesId !== series.id && (
                    <span className="muted series-picker-move-hint">
                      (已在其他系列)
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </>
      )}

      <footer className="series-picker-footer">
        <button type="button" onClick={onBack} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleConfirm()}
          disabled={busy || picked.size === 0}
        >
          {busy ? '加入中...' : `加入「${series.name}」(${picked.size})`}
        </button>
      </footer>
    </div>
  )
}
