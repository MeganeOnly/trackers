// packages/tracker-ui/src/GraphView/nodeRadius.ts
//
// 节点半径公式 —— 与 react-force-graph-2d 的 paintNodes / getGraphBbox 公式同步。
//
// react-force-graph-2d 源码（force-graph.mjs paintNodes）：
//   const val = accessorFn(state.nodeVal)(node) || 1;
//   const r = Math.sqrt(Math.max(0, val)) * state.nodeRelSize;
//
// 即：  r = sqrt(NODE_SIZE_FN(n)) * nodeRelSize
//  其中 NODE_SIZE_FN(n) = 1 + sqrt(n.refCount) * 2（在 GraphView/index.tsx 定义）
//       nodeRelSize = 4（react-force-graph-2d 默认）
//
// 提供这个共享公式的原因：
//   1) collision force 的 radius 参数必须等于"实际画到画布上的半径"，
//      否则节点会被两套不同的尺寸算 overlap。
//   2) 树形布局 + 标签视觉间距也要按这个半径算。
//   3) GraphView/index.tsx 的 NODE_SIZE_FN 是给 react-force-graph 的 nodeVal prop，
//      不是像素半径；提取专门的 radius 函数避免再写一份 sqrt。
//
// 这里仅放纯函数 + 常量，不依赖 React / d3 / force-graph，可在测试里直接 import。

import type { BaseGraphNode } from './types'

/** react-force-graph-2d 默认的 nodeRelSize。改这个数前先看 useGraphPhysics.ts 注释。 */
export const NODE_REL_SIZE = 4

/**
 * 与 react-force-graph-2d 同步的"画到画布上的节点半径"（像素）。
 *
 * 重要：因为 react-force-graph 内部就是用这个公式画圆（fill radius = r），
 *       collision force 必须用它，否则"绘制"与"碰撞"会按两套尺寸算，
 *       把"画完后看上去相邻"的两个节点当 collision 看时已经压在一坨。
 */
export function computeNodeRenderRadius(node: BaseGraphNode): number {
  const val = 1 + Math.sqrt(node.refCount) * 2
  return Math.sqrt(Math.max(0, val)) * NODE_REL_SIZE
}
