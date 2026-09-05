// 系列管理视图(v1.8 起)—— 从原 SeriesModal 抽出,作为 AddModal「系列」tab 的内容。
//
// **为什么抽出来**:与 BookFormFields 同款 —— AddModal 自身是一个 Modal,内容
// 必须不含 Modal 包装,否则 Modal 内嵌 Modal。本组件只负责 series 的 list+CRUD
// 主体,Modal 包装由 AddModal 提供。
//
// **职责**:展示所有 series + CRUD(create / update / delete)。
//
// **成员计数派生**:`useBooksStore` 全量 books + 当前 seriesList → 派生
// `seriesBookCount: Map<seriesId, number>`,纯计算不缓存(数据量小,几百本以内)。
//
// **删除交互**:弹浏览器原生 confirm 二次确认 —— 跟 deleteBook 同款策略
// (避免误操作删了辛苦建好的系列)。删除成功后:
// - Rust 端联动清理所有 book 的 seriesId 引用(单向清理,不做重定向)
// - 主动 reload books store 让前端状态同步(数量小,走全量 reload)
//
// **编辑交互**:点「编辑」进入 inline edit mode → 改 name + notes → 保存 / 取消。
// 名字空校验:前端先 check,后端 service 再兜底。
//
// **新建交互**:顶部 inline input + 「+ 新建」按钮。
//
// **v1.9 新增 view 状态机**:从 SeriesView 这一侧提供「往系列里加/减成员」入口
// (用户诉求:"想从系列侧管理成员,不必逐本 BookDetail 进进出出")。
// - 'list'   —— 默认列表视图,行可点击(空白处 / name / (N 本) / id 都触发)
// - 'detail' —— SeriesDetailBody:看成员 + 移除成员 + 「+ 添加作品」入口
// - 'picker' —— SeriesPickBooksBody:多选候选 books → 批量 setSeries
// view 切换全部在 AddModal 内部进行,无 Modal 嵌套(v1.8 反模式 §十.35)。

import { useEffect, useState } from 'react'
import { useSeriesStore } from '../store/series'
import { useBooksStore } from '../store/books'
import { SeriesDetailBody } from './SeriesDetailBody'
import { SeriesPickBooksBody } from './SeriesPickBooksBody'

interface EditingState {
  id: string
  name: string
  notes: string
}

type ViewMode = 'list' | 'detail' | 'picker'

export function SeriesView(): JSX.Element {
  const seriesList = useSeriesStore((s) => s.series)
  const loading = useSeriesStore((s) => s.loading)
  const loadSeries = useSeriesStore((s) => s.load)
  const createSeries = useSeriesStore((s) => s.create)
  const updateSeries = useSeriesStore((s) => s.update)
  const removeSeries = useSeriesStore((s) => s.remove)
  const books = useBooksStore((s) => s.books)
  const loadBooks = useBooksStore((s) => s.load)
  const setSeries = useBooksStore((s) => s.setSeries)

  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  // v1.9 view 状态机
  const [view, setView] = useState<ViewMode>('list')
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null)
  /** 移除中的 book.id(灰掉对应行的 × 按钮,避免重复点击) */
  const [removingId, setRemovingId] = useState<string | null>(null)
  /** 批量加入进行中(灰掉全部按钮) */
  const [picking, setPicking] = useState(false)

  // 打开时确保 series + books 列表最新
  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

  // 派生 series → member count(详情视图跟 list 视图共用)
  const memberCount = new Map<string, number>()
  for (const b of books) {
    const sid = b.seriesId
    if (sid) {
      memberCount.set(sid, (memberCount.get(sid) ?? 0) + 1)
    }
  }

  const selectedSeries =
    selectedSeriesId !== null
      ? seriesList.find((s) => s.id === selectedSeriesId) ?? null
      : null

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) {
      setNewError('系列名不能为空')
      return
    }
    setNewError(null)
    try {
      await createSeries({ name: newName.trim(), notes: '' })
      setNewName('')
    } catch (e) {
      setNewError(e instanceof Error ? e.message : String(e))
    }
  }

  function startEdit(id: string): void {
    const s = seriesList.find((x) => x.id === id)
    if (!s) return
    setEditing({ id, name: s.name, notes: s.notes ?? '' })
    setEditError(null)
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editing) return
    if (!editing.name.trim()) {
      setEditError('系列名不能为空')
      return
    }
    setEditError(null)
    try {
      await updateSeries(editing.id, {
        name: editing.name.trim(),
        notes: editing.notes
      })
      setEditing(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete(id: string, name: string): Promise<void> {
    const count = memberCount.get(id) ?? 0
    const msg =
      count > 0
        ? `确定删除「${name}」?\n\n该系列下有 ${count} 本作品,关联会被自动清理(作品的"所属系列"会变成"未设置")。`
        : `确定删除「${name}」?`
    if (!confirm(msg)) return
    try {
      await removeSeries(id)
      // 后端已联动清理,前端 reload 让 books.seriesId 同步刷新
      await loadBooks()
      // 如果删的正是当前 detail / picker 视图的 series,回到 list
      if (selectedSeriesId === id) {
        setSelectedSeriesId(null)
        setView('list')
      }
    } catch (e) {
      console.error('series delete failed:', e)
      alert(`删除失败:${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function openDetail(id: string): void {
    setSelectedSeriesId(id)
    setEditing(null)
    setEditError(null)
    setView('detail')
  }

  function backToList(): void {
    setView('list')
    // selectedSeriesId 保留以便编辑时定位;不影响列表渲染
    setRemovingId(null)
  }

  function openPicker(): void {
    setView('picker')
  }

  async function handleRemoveMember(bookId: string, bookTitle: string): Promise<void> {
    if (!selectedSeries) return
    if (!confirm(`确定从「${selectedSeries.name}」移除《${bookTitle}》?`)) return
    setRemovingId(bookId)
    try {
      await setSeries(bookId, null)
    } catch (e) {
      alert(`移除失败:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRemovingId(null)
    }
  }

  async function handlePickConfirm(selectedIds: string[]): Promise<void> {
    if (!selectedSeries) return
    setPicking(true)
    const failures: { id: string; title: string; error: string }[] = []
    let succeeded = 0
    // 串行而非 Promise.all —— 顺序写盘避免 books store 多次 upsertBook 竞争
    // (zustand 的 set 本身是同步的,串行更稳;数量小(几十本)性能完全够用)
    for (const id of selectedIds) {
      const b = books.find((x) => x.id === id)
      const title = b?.title ?? id
      try {
        await setSeries(id, selectedSeries.id)
        succeeded++
      } catch (e) {
        failures.push({
          id,
          title,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }
    setPicking(false)
    if (failures.length === 0) {
      // 全部成功:回到 detail,显示已加入的成员
      setView('detail')
    } else if (succeeded === 0) {
      // 全部失败:留在 picker 让用户决定(调整后再试 / 取消)
      const summary = failures
        .map((f) => `· 《${f.title}》(id: ${f.id}): ${f.error}`)
        .join('\n')
      alert(`全部加入失败 (${failures.length} 本):\n\n${summary}`)
    } else {
      // 部分失败:回到 detail(成功的可见),alert 告知失败清单
      setView('detail')
      const summary = failures
        .map((f) => `· 《${f.title}》(id: ${f.id}): ${f.error}`)
        .join('\n')
      alert(`成功 ${succeeded} 本,失败 ${failures.length} 本:\n\n${summary}`)
    }
  }

  // ---- 渲染分派 ----
  if (view === 'detail' && selectedSeries) {
    return (
      <SeriesDetailBody
        series={selectedSeries}
        books={books}
        onBack={backToList}
        onPickAdd={openPicker}
        onRemoveMember={handleRemoveMember}
        removingId={removingId}
      />
    )
  }
  if (view === 'picker' && selectedSeries) {
    return (
      <SeriesPickBooksBody
        series={selectedSeries}
        books={books}
        onBack={() => setView('detail')}
        onConfirm={handlePickConfirm}
        busy={picking}
      />
    )
  }

  // list view(默认)
  return (
    <div className="series-modal-body">
      <div className="series-create">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新系列名 (例:三体、大明王朝)"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleCreate()
            }
          }}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleCreate()}
          disabled={!newName.trim()}
        >
          + 新建
        </button>
        {newError && <span className="error">{newError}</span>}
      </div>

      {loading && seriesList.length === 0 ? (
        <p className="muted">加载中...</p>
      ) : seriesList.length === 0 ? (
        <p className="muted empty-hint">
          还没有系列 —— 在上面输入名字 + 「+ 新建」开始
        </p>
      ) : (
        <ul className="series-list">
          {seriesList.map((s) => {
            const count = memberCount.get(s.id) ?? 0
            const isEditing = editing?.id === s.id
            return (
              <li
                key={s.id}
                className={`series-list-row series-list-row-clickable${isEditing ? ' series-list-row-editing' : ''}`}
                onClick={isEditing ? undefined : () => openDetail(s.id)}
                onKeyDown={(e) => {
                  if (isEditing) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openDetail(s.id)
                  }
                }}
                tabIndex={isEditing ? -1 : 0}
                role={isEditing ? undefined : 'button'}
                aria-label={isEditing ? undefined : `打开系列「${s.name}」管理成员`}
                title={isEditing ? undefined : '点击管理成员(添加/移除)'}
              >
                {isEditing ? (
                  <div className="series-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                      placeholder="系列名"
                      autoFocus
                    />
                    <textarea
                      value={editing.notes}
                      onChange={(e) =>
                        setEditing({ ...editing, notes: e.target.value })
                      }
                      placeholder="简介 (可选)"
                      rows={2}
                    />
                    <div className="series-edit-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void handleSaveEdit()}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(null)
                          setEditError(null)
                        }}
                      >
                        取消
                      </button>
                      {editError && (
                        <span className="error">{editError}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="series-info">
                      <span className="series-name">{s.name}</span>
                      <span className="series-count muted">
                        ({count} 本)
                      </span>
                      <span className="tracker-id muted">{s.id}</span>
                    </div>
                    {s.notes && (
                      <div className="series-notes muted">{s.notes}</div>
                    )}
                    <div className="series-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => startEdit(s.id)}
                        title="编辑系列"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => void handleDelete(s.id, s.name)}
                        title="删除系列 (联动清理 book 引用)"
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
