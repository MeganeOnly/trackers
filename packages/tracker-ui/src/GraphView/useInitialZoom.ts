// packages/tracker-ui/src/GraphView/useInitialZoom.ts
//
// 默认初始 zoom —— 把 react-force-graph-2d 的"按节点数缩放"默认值
// 替换成更大的版本,解决"图打开后看着挤"的视觉问题。
//
// 现象(2026-08 v11→v12):经过 v7→v10 一路把 charge/centripetal/linkDistance
// 调到力导向集群风格后,用户继续反馈"节点还是看着挤 / 默认再大一点"。
// 检查发现一部分原因是 react-force-graph-2d 的默认初始 zoom 太小 ——
// 它的内部公式是 `ZOOM2NODES_FACTOR(4) / Math.cbrt(N)`,N=27 时 zoom ≈
// 1.33;节点在画布上只占视觉区域的一小块,即便物理布局已经拉开,人眼
// 看仍觉得"挤"。v11 用 6/cbrt(N) 提到 ~1.5× 默认;v12 再提到 8/cbrt(N)
// (~2× 默认) + cap 2.0→2.5,用户视觉上才觉得"够大"。
//
// 修复:本 hook 在 fgRef 首次就绪 + 节点数 > 0 时一次性把 zoom 设到自定
// 义公式(8 / cbrt(N),N 小时额外 cap 在 2.5),实现 ~100% 放大(2× 库默认):
//
//   N=8   → zoom ≈ 2.5  (cap 生效)
//   N=27  → zoom ≈ 2.5  (8/3 ≈ 2.67 → cap 在 2.5)
//   N=64  → zoom ≈ 2.0  (8/4)
//   N=216 → zoom ≈ 1.33 (8/6)
//   N=512 → zoom ≈ 1.0  (8/8,到 floor)
//
// 实现细节(关键,否则会被库反复覆盖回默认):
//   - react-force-graph-2d 的 `onFinishUpdate` 有这段:
//       if (transform(state.canvas).k === state.lastSetZoom && graphData.nodes.length) {
//         state.zoom.scaleTo(elem, state.lastSetZoom = ZOOM2NODES_FACTOR / cbrt(N));
//       }
//     即"当前 zoom == 上次设置的 zoom"才覆盖。 我用 `fg.zoom(myK, 0)`
//     (内部是 `state.zoom.scaleTo(elem, myK)`) 设置 zoom —— 这条路径**不
//     会**更新 `state.lastSetZoom`,所以下次 onFinishUpdate 看到
//     `transform.k (myK) !== lastSetZoom (库默认)` → 跳过覆盖,我的 zoom 持久。
//   - 用 `zoomAppliedRef` 哨兵只跑一次:首次 ready 后立刻 setZoom,后续
//     数据变化(filter / 加书)不会重置 zoom —— 用户手手动 zoom 后也不会
//     被悄悄覆盖。 这与原版"每次 onFinishUpdate 都覆盖"的语义不同,
//     但更符合直觉(用户加一本书图不应该自己缩放)。
//
// 与 useAutoCenter 的边界:
//   - useAutoCenter 只在 highlightId 变化时跑,管 centerAt;
//   - useInitialZoom 只在首次 ready 跑一次,管 zoom;
//   - 两者互不冲突,可以同时存在。

import { useEffect, useRef } from 'react'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import type { BaseGraphNode } from './types'

/** 自定义初始 zoom 公式系数 —— 比 react-force-graph-2d 内部 ZOOM2NODES_FACTOR (4) 大 100%。
 *  v11 (2026-08) 初版用 6 (= 1.5× 库默认);用户反馈"再大一点",v12 提到 8 (= 2× 库默认)。
 *  公式仍是 clamp(FACTOR / cbrt(N), floor, cap),只是 FACTOR 整体推高。 */
export const INITIAL_ZOOM_FACTOR = 8
/** zoom 上限 —— v11 用 2.0,用户继续要更大,v12 提到 2.5。 小图 zoom 太大会让
 *  节点飞出画布边缘(用户需手动 pan 看其余节点),但用户的偏好就是"看得见
 *  每一个节点 > 看完全图",所以默认就偏激进。 */
export const INITIAL_ZOOM_CAP = 2.5
/** zoom 下限 —— 大图不再放大(交还给库默认的 cbrt 衰减),节点全可见 */
export const INITIAL_ZOOM_FLOOR = 1.0

/**
 * 按节点数算初始 zoom —— 暴露为纯函数便于单测覆盖 + 复用。
 *
 * @param nodeCount 当前可见节点数(visibleData.nodes.length,filter 后的)
 * @returns 给 fg.zoom() 的目标缩放系数
 */
export function computeInitialZoom(nodeCount: number): number {
  if (nodeCount <= 0) return INITIAL_ZOOM_FLOOR
  const raw = INITIAL_ZOOM_FACTOR / Math.cbrt(nodeCount)
  return Math.max(INITIAL_ZOOM_FLOOR, Math.min(INITIAL_ZOOM_CAP, raw))
}

/**
 * 首次就绪时把 fg zoom 设到自定义初始值。 一次性,用 ref 哨兵保证。
 *
 * @param fgRef react-force-graph-2d 的 ref
 * @param nodes 当前可见节点列表 —— 用 length 算 zoom,引用变化不触发 effect 重跑
 */
export function useInitialZoom(
  fgRef: React.RefObject<ForceGraphMethods<unknown, unknown> | undefined>,
  nodes: BaseGraphNode[]
): void {
  const zoomAppliedRef = useRef(false)
  useEffect(() => {
    if (zoomAppliedRef.current) return
    const fg = fgRef.current
    if (!fg || nodes.length === 0) return
    const k = computeInitialZoom(nodes.length)
    try {
      /* transitionDuration=0 同步应用,避免一闪而过的 zoom tween;
       * fg.zoom 内部走 d3-zoom 的 scaleTo,虽然不更新 state.lastSetZoom,
       * 但 onFinishUpdate 的"transform.k === lastSetZoom 才覆盖"判断
       * 仍然会跳过我们的自定义值 —— 见文件头注释。 */
      fg.zoom(k, 0)
      zoomAppliedRef.current = true
    } catch (e) {
      console.warn('initial zoom set failed:', e)
    }
  }, [fgRef, nodes])
}