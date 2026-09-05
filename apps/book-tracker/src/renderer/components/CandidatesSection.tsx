// v2.x 候选剧集 section —— 在 SettingsPanel 左栏展示。
//
// 设计要点：
// - 名字+tag 密集布局（参考 AGENTS.md §"密集列表"）
// - 每项三按钮：+加（promote want）/ ✓看（promote finished）/ ×删
// - promote 后 store 自动刷新（candidates remove + books reload）
// - 空态：友好提示「问问 book-tracker-rec 帮你推荐」

import { useCandidatesStore } from '../store/candidates'

export function CandidatesSection(): JSX.Element {
  const items = useCandidatesStore((s) => s.items)
  const loading = useCandidatesStore((s) => s.loading)
  const error = useCandidatesStore((s) => s.error)
  const remove = useCandidatesStore((s) => s.remove)
  const promote = useCandidatesStore((s) => s.promote)

  async function handlePromote(id: string, status: 'want' | 'finished'): Promise<void> {
    try {
      await promote(id, status)
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function handleRemove(id: string): Promise<void> {
    // eslint-disable-next-line no-alert
    if (!confirm('从候选清单删除？')) return
    try {
      await remove(id)
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="candidates-section">
      <div className="field-label">
        待选剧集 ({items.length})
        <span
          className="field-info"
          tabIndex={0}
          role="img"
          aria-label="book-tracker-rec 等技能推荐 / 你看到感兴趣的剧，但还没决定正式加入书架时，加到这里暂存。点 +加 转 want，点 ✓看 转 finished，点 ×删 仅移除候选。"
        >
          ?
        </span>
      </div>
      {loading && items.length === 0 ? (
        <p className="muted candidates-empty">加载中…</p>
      ) : error ? (
        <p className="muted candidates-empty">加载失败：{error}</p>
      ) : items.length === 0 ? (
        <p className="muted candidates-empty">
          还没有候选剧。
          <br />
          问问 book-tracker-rec 帮你推荐。
        </p>
      ) : (
        <ul className="candidate-list">
          {items.map((c) => (
            <li key={c.id} className="candidate-item">
              <div className="candidate-row1">
                <span className="candidate-title">{c.title}</span>
              </div>
              {c.tags.length > 0 && (
                <div className="candidate-row2">
                  {c.tags.map((t) => (
                    <span key={t} className="candidate-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {c.note && <div className="candidate-note">{c.note}</div>}
              <div className="candidate-actions">
                <button
                  className="candidate-btn"
                  onClick={() => handlePromote(c.id, 'want')}
                  title="按 status=want 加入书架（之后在编辑模式补元数据）"
                >
                  +加
                </button>
                <button
                  className="candidate-btn"
                  onClick={() => handlePromote(c.id, 'finished')}
                  title="按 status=finished 标记已看"
                >
                  ✓看
                </button>
                <button
                  className="candidate-btn candidate-btn-danger"
                  onClick={() => handleRemove(c.id)}
                  title="从候选清单移除（不写入书架）"
                >
                  ×删
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
