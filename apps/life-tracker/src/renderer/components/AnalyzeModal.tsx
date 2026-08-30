import { useMemo } from 'react'
import { Modal } from './Modal'
import { useGoalsStore } from '../store/goals'
import { useGraphAnalysis } from '../store/selectors'
import type { GraphAnalysis } from '@core'

interface AnalyzeModalProps {
  onClose: () => void
}

/**
 * 图健康度分析 Modal —— 把 useGraphAnalysis 算出的全部分析结果列表化展示。
 *
 * 设计目标：
 * - 全量信息一行一项，便于用户在 CleanMode / EditMode 不开图就能扫一眼全局
 * - 复用 Modal 基座（Esc 关闭、点 backdrop 关闭、width prop）
 * - 不写盘、不修改 store：纯展示
 * - 颜色按分数档位给提示（绿/黄/红），但不用任何图例——分数本身就是信息
 */
export function AnalyzeModal({ onClose }: AnalyzeModalProps): JSX.Element {
  const goals = useGoalsStore((s) => s.goals)
  const analysis = useGraphAnalysis()
  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of goals) m.set(g.id, g.title)
    return m
  }, [goals])

  return (
    <Modal title="图分析" onClose={onClose} width={720}>
      <AnalyzeBody analysis={analysis} titleById={titleById} />
    </Modal>
  )
}

interface AnalyzeBodyProps {
  analysis: GraphAnalysis
  titleById: Map<string, string>
}

function AnalyzeBody({ analysis, titleById }: AnalyzeBodyProps): JSX.Element {
  const { stats, healthScore, healthBreakdown, criticalPath, bottlenecks, roots, leaves, orphans } =
    analysis

  // 颜色按分数档位：≥80 绿、≥60 黄、其他红
  const scoreColor =
    healthScore >= 80 ? '#2d5a3a' : healthScore >= 60 ? '#c89456' : '#c0573d'

  return (
    <div className="analyze-body">
      {/* 健康度 + 拆解 */}
      <section className="analyze-section">
        <h4>健康度</h4>
        <div className="analyze-score-row">
          <span className="analyze-score-num" style={{ color: scoreColor }}>
            {healthScore}
          </span>
          <span className="analyze-score-max">/100</span>
        </div>
        <ul className="analyze-breakdown">
          <li>
            完成率
            <span className="muted">
              {(stats.completionRate * 100).toFixed(0)}% → +{healthBreakdown.completionRateScore}
            </span>
          </li>
          <li>
            孤立节点
            <span className="muted">
              {orphans.length} 个 → +{healthBreakdown.orphanScore}
            </span>
          </li>
          <li>
            瓶颈节点
            <span className="muted">
              {bottlenecks.length} 个 → +{healthBreakdown.bottleneckScore}
            </span>
          </li>
        </ul>
      </section>

      {/* 基础统计 */}
      <section className="analyze-section">
        <h4>基础统计</h4>
        <ul className="analyze-stats">
          <li>
            <span className="muted">总目标</span>
            <strong>{stats.total}</strong>
          </li>
          <li>
            <span className="muted">已达成</span>
            <strong>{stats.done}</strong>
          </li>
          <li>
            <span className="muted">完成率</span>
            <strong>{(stats.completionRate * 100).toFixed(1)}%</strong>
          </li>
          <li>
            <span className="muted">平均入度</span>
            <strong>{stats.avgInDegree.toFixed(2)}</strong>
          </li>
          <li>
            <span className="muted">平均出度</span>
            <strong>{stats.avgOutDegree.toFixed(2)}</strong>
          </li>
          <li>
            <span className="muted">关键路径</span>
            <strong>{stats.maxDepth}</strong>
          </li>
          <li>
            <span className="muted">连通分量</span>
            <strong>{stats.components}</strong>
          </li>
        </ul>
      </section>

      {/* 关键路径 */}
      <section className="analyze-section">
        <h4>关键路径（{criticalPath.length === 0 ? '无' : `${criticalPath.length} 步`}）</h4>
        {criticalPath.length === 0 ? (
          <p className="muted empty-hint">没有未完成的链——所有目标都已达成或其前置都完成。</p>
        ) : (
          <p className="analyze-path">
            {criticalPath.map((id, i) => (
              <span key={id} className="analyze-path-item">
                <span className="analyze-path-id">{titleById.get(id) ?? id}</span>
                {i < criticalPath.length - 1 && <span className="analyze-path-sep"> → </span>}
              </span>
            ))}
          </p>
        )}
      </section>

      {/* 瓶颈 */}
      <section className="analyze-section">
        <h4>瓶颈（{bottlenecks.length} 个）</h4>
        {bottlenecks.length === 0 ? (
          <p className="muted empty-hint">没有瓶颈——所有未完成目标都不被其他目标依赖。</p>
        ) : (
          <ul className="analyze-list">
            {bottlenecks.map((b) => (
              <li key={b.id}>
                <span className="analyze-list-title">{titleById.get(b.id) ?? b.id}</span>
                <span className="muted">
                  阻塞 <strong>{b.blocks.length}</strong> 个
                  {b.blocks.length > 0 && (
                    <>
                      {' '}
                      (
                      {b.blocks
                        .slice(0, 3)
                        .map((bid) => titleById.get(bid) ?? bid)
                        .join('、')}
                      {b.blocks.length > 3 && '…'})
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 根 / 叶 */}
      <section className="analyze-section">
        <div className="analyze-two-col">
          <div>
            <h4>根（{roots.length} 个）</h4>
            {roots.length === 0 ? (
              <p className="muted empty-hint">—</p>
            ) : (
              <ul className="analyze-list">
                {roots.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <span className="analyze-list-title">{titleById.get(r.id) ?? r.id}</span>
                    <span className="muted">出口 {r.outDegree} 个</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4>叶（{leaves.length} 个）</h4>
            {leaves.length === 0 ? (
              <p className="muted empty-hint">—</p>
            ) : (
              <ul className="analyze-list">
                {leaves.slice(0, 8).map((id) => (
                  <li key={id}>
                    <span className="analyze-list-title">{titleById.get(id) ?? id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 孤立 */}
      <section className="analyze-section">
        <h4>
          孤立（{orphans.length} 个）
          {orphans.length > 0 && <span className="muted">— 建议清理或建立关系</span>}
        </h4>
        {orphans.length === 0 ? (
          <p className="muted empty-hint">没有孤立节点——所有目标都连入了关系图。</p>
        ) : (
          <ul className="analyze-list">
            {orphans.map((id) => (
              <li key={id}>
                <span className="analyze-list-title">{titleById.get(id) ?? id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}