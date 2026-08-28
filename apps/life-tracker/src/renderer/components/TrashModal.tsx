import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useTrashStore } from '../store/trash'
import { useGoalsStore } from '../store/goals'
import { useRelationsStore } from '../store/relations'
import type { TrashEntry } from '@shared/api'

interface TrashModalProps {
  onClose: () => void
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  // > 30 天显示完整日期（YYYY-MM-DD 截断 ISO 字符串）
  const iso = new Date(ms).toISOString()
  return iso.slice(0, 10)
}

export function TrashModal({ onClose }: TrashModalProps): JSX.Element {
  const entries = useTrashStore((s) => s.entries)
  const loading = useTrashStore((s) => s.loading)
  const error = useTrashStore((s) => s.error)
  const load = useTrashStore((s) => s.load)
  const restore = useTrashStore((s) => s.restore)
  const purge = useTrashStore((s) => s.purge)
  const empty = useTrashStore((s) => s.empty)
  const loadGoals = useGoalsStore((s) => s.load)
  const loadRelations = useRelationsStore((s) => s.load)

  const [busy, setBusy] = useState(false)

  // 打开时强制刷新一次（避免 App.tsx 启动时没拉的条目过期）
  useEffect(() => {
    void load()
  }, [load])

  async function handleRestore(e: TrashEntry): Promise<void> {
    setBusy(true)
    try {
      await restore(e.goal_id, e.deleted_at)
      // restore 后 goals + relations 都变了；重拉一次
      await Promise.all([loadGoals(), loadRelations()])
    } catch (err) {
      alert(`还原失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handlePurge(e: TrashEntry): Promise<void> {
    if (!confirm(`永久删除《${e.title || '(无标题)'}》？此操作不可撤销。`)) return
    setBusy(true)
    try {
      await purge(e.goal_id, e.deleted_at)
    } catch (err) {
      alert(`删除失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleEmpty(): Promise<void> {
    if (!confirm(`清空回收站（${entries.length} 个条目）？此操作不可撤销。`)) return
    setBusy(true)
    try {
      await empty()
    } catch (err) {
      alert(`清空失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`回收站（${entries.length}）`}
      onClose={onClose}
      width={600}
      footer={
        <div className="form-footer">
          {entries.length > 0 && (
            <button type="button" className="btn-danger" onClick={() => void handleEmpty()} disabled={busy}>
              全部清空
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>
      }
    >
      {error && <p className="form-error">{error}</p>}
      {loading && entries.length === 0 ? (
        <p className="muted">载入中…</p>
      ) : entries.length === 0 ? (
        <p className="muted">回收站是空的。</p>
      ) : (
        <ul className="trash-list">
          {entries.map((e) => (
            <li key={`${e.goal_id}_${e.deleted_at}`} className="trash-item">
              <div className="trash-item-info">
                <span className="title">{e.title || '(无标题)'}</span>
                <span className="meta muted">
                  {e.category || '未分类'}
                  {' · id '}
                  {e.goal_id}
                  {' · 删除于 '}
                  {relativeTime(e.deleted_at)}
                </span>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleRestore(e)}
                  disabled={busy}
                  title="还原到目标列表"
                >
                  还原
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void handlePurge(e)}
                  disabled={busy}
                  title="永久删除（不可撤销）"
                >
                  永久删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
