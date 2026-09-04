// 系列管理 modal(v1.7 新增)—— TopBar「系」按钮打开。
//
// 职责:展示所有 series + CRUD(create / update / delete),成员关系不在这里管。
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

import { useEffect, useState } from 'react'
import { useSeriesStore } from '../store/series'
import { useBooksStore } from '../store/books'
import { Modal } from './Modal'

interface SeriesModalProps {
  onClose: () => void
}

interface EditingState {
  id: string
  name: string
  notes: string
}

export function SeriesModal({ onClose }: SeriesModalProps): JSX.Element {
  const seriesList = useSeriesStore((s) => s.series)
  const loading = useSeriesStore((s) => s.loading)
  const loadSeries = useSeriesStore((s) => s.load)
  const createSeries = useSeriesStore((s) => s.create)
  const updateSeries = useSeriesStore((s) => s.update)
  const removeSeries = useSeriesStore((s) => s.remove)
  const books = useBooksStore((s) => s.books)
  const loadBooks = useBooksStore((s) => s.load)

  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  // 打开时确保 series + books 列表最新
  useEffect(() => {
    void loadSeries()
  }, [loadSeries])

  // 派生 series → member count
  const memberCount = new Map<string, number>()
  for (const b of books) {
    const sid = b.seriesId
    if (sid) {
      memberCount.set(sid, (memberCount.get(sid) ?? 0) + 1)
    }
  }

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
    } catch (e) {
      console.error('series delete failed:', e)
      alert(`删除失败:${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <Modal title="系列" onClose={onClose} width={560}>
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
                <li key={s.id} className="series-list-row">
                  {isEditing ? (
                    <div className="series-edit">
                      <input
                        type="text"
                        value={editing.name}
                        onChange={(e) =>
                          setEditing({ ...editing, name: e.target.value })
                        }
                        placeholder="系列名"
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
                      <div className="series-actions">
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
    </Modal>
  )
}