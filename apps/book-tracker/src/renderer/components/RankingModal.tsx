import { useEffect, useMemo, useState } from 'react'
import type { WorkKind } from '@shared/types'
import { WORK_KIND_ORDER } from '@shared/types'
import { Modal } from './Modal'
import { RankingKindSelect } from './RankingKindSelect'
import { RankingList } from './RankingList'
import { RankingCompare } from './RankingCompare'
import { useBooksStore } from '../store/books'
import { useRankingStore } from '../store/ranking'

interface RankingModalProps {
  onClose: () => void
}

type Tab = 'list' | 'compare'

/**
 * 排名 Modal 容器：
 * - 顶部：kind 选择器 + 总对比次数
 * - 中部：tab 切换「排名列表 / 开始对比」
 * - 打开时自动从后端加载 RankingFile；切 kind 时自动选 pair
 */
export function RankingModal({ onClose }: RankingModalProps): JSX.Element {
  const books = useBooksStore((s) => s.books)
  const loadRanking = useRankingStore((s) => s.load)
  const file = useRankingStore((s) => s.file)
  const kind = useRankingStore((s) => s.kind)
  const setKind = useRankingStore((s) => s.setKind)
  const sessionCount = useRankingStore((s) => s.sessionCount)
  const resetSession = useRankingStore((s) => s.resetSession)

  const [tab, setTab] = useState<Tab>('list')

  // 打开时拉一次 ranking 文件
  useEffect(() => {
    void loadRanking()
  }, [loadRanking])

  // 默认 kind：选第一个有 finished 作品的 kind
  useEffect(() => {
    if (kind) return
    for (const k of WORK_KIND_ORDER) {
      if (books.some((b) => b.status === 'finished' && b.kind === k)) {
        setKind(k)
        return
      }
    }
    // 没有任何 finished → 默认选 'book'，空状态展示
    setKind('book')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books])

  // 切 kind 时切到列表 tab（避免进入对比态但还没 pair）
  useEffect(() => {
    setTab('list')
  }, [kind])

  // 各个 kind 的 finished 数量（给 kind selector 用）
  const kindCounts = useMemo(() => {
    const counts: Partial<Record<WorkKind, number>> = {}
    for (const k of WORK_KIND_ORDER) counts[k] = 0
    for (const b of books) {
      if (b.status === 'finished') counts[b.kind] = (counts[b.kind] ?? 0) + 1
    }
    return counts
  }, [books])

  const totalFinished = books.filter((b) => b.status === 'finished').length
  const totalPoolForKind = kind ? kindCounts[kind] ?? 0 : 0

  return (
    <Modal
      title="作品排名"
      onClose={onClose}
      width={780}
      className="modal-card--ranking"
    >
      <div className="ranking-toolbar">
        <RankingKindSelect value={kind} onChange={setKind} counts={kindCounts} />
        <div className="ranking-toolbar-stats">
          <span>已完成 {totalFinished} 本</span>
          <span className="dot">·</span>
          <span>当前池 {totalPoolForKind} 本</span>
          <span className="dot">·</span>
          <span>历史对比 {file.history.length} 次</span>
          {sessionCount > 0 && (
            <>
              <span className="dot">·</span>
              <span>本次 +{sessionCount}</span>
              <button className="ranking-toolbar-reset" onClick={resetSession} title="清零本次计数">
                ×
              </button>
            </>
          )}
        </div>
      </div>

      <div className="ranking-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'list'}
          className={`ranking-tab${tab === 'list' ? ' active' : ''}`}
          onClick={() => setTab('list')}
        >
          排名列表
        </button>
        <button
          role="tab"
          aria-selected={tab === 'compare'}
          className={`ranking-tab${tab === 'compare' ? ' active' : ''}`}
          onClick={() => setTab('compare')}
        >
          开始对比
        </button>
      </div>

      <div className="ranking-body">
        {tab === 'list' ? (
          <RankingList pool={books} kind={kind} />
        ) : (
          <RankingCompare pool={books} />
        )}
      </div>
    </Modal>
  )
}
