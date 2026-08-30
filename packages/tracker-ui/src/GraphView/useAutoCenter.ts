// packages/tracker-ui/src/GraphView/useAutoCenter.ts
//
// "两段式居中"：
//   1) highlightId 变化后立即 centerAt（即时反馈；此时可能碰上画布 resize / 模拟还在跑，位置是近似的）
//   2) 等力导向模拟收敛（d3 默认 alphaMin≈0.001，约 300 帧 ≈5s）后，按节点最终位置再精确居中一次。
//      不能暂停模拟：pauseAnimation 会 cancelAnimationFrame 停掉整个渲染循环，
//      居中 tween 画不出来、hover/点击命中也会失效（点了没反应）。
//
// 与原 GraphView 的两段式居中行为一致；只是抽出共享。
// 注意：d3 自动冷却时间随 alpha 衰减，初始 highlight 后中心节点可能在运动，
//       settle 之后节点位置已稳定，二次居中保证精确。

import { useEffect, useRef } from 'react'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import type { BaseGraphNode, BaseGraphLink } from './types'
import type { Dims } from './useResize'

/** 二次居中延迟（ms）—— 等 d3 alpha 衰减到接近 min */
export const SETTLE_DELAY_MS = 2500
/** 首次立即居中的 tween 时长（ms） */
export const IMMEDIATE_CENTER_MS = 350
/** 二次精确居中的 tween 时长（ms） */
export const SETTLE_CENTER_MS = 250

export function useAutoCenter(
  fgRef: React.RefObject<ForceGraphMethods<unknown, unknown> | undefined>,
  nodes: BaseGraphNode[],
  dims: Dims,
  highlightId: string | null | undefined
): void {
  const settleTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  // 1) 立即居中
  useEffect(() => {
    if (!highlightId || !fgRef.current) return
    const node = nodes.find((n) => n.id === highlightId)
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      fgRef.current.centerAt(node.x, node.y, IMMEDIATE_CENTER_MS)
    }
  }, [highlightId, nodes, dims])

  // 2) 等模拟收敛后二次居中
  useEffect(() => {
    window.clearTimeout(settleTimer.current)
    if (!highlightId) return
    settleTimer.current = window.setTimeout(() => {
      if (!fgRef.current) return
      const node = nodes.find((n) => n.id === highlightId)
      if (node && typeof node.x === 'number' && typeof node.y === 'number') {
        fgRef.current.centerAt(node.x, node.y, SETTLE_CENTER_MS)
      }
    }, SETTLE_DELAY_MS)
    return () => window.clearTimeout(settleTimer.current)
  }, [highlightId, nodes])
}