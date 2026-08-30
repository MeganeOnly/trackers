// packages/tracker-ui/src/GraphView/d3-force-3d.d.ts
//
// d3-force-3d 是一个私有包（vasturiano 自己维护），目前没有发布官方类型定义。
// 我们只用 forceCollide + simulation 的最窄子集，写一个最小 ambient declaration。
//
// 只为这一个库的 forceCollide 给类型 —— 不写 d3-force / d3-force-3d 全量定义，
// 避免与未来其他 d3-force-3d 用法的潜在类型冲突（force-graph / collision 其他
// 字段我们用不到，扩展时再补）。

declare module 'd3-force-3d' {
  /**
   * d3-force-3d 的 forceCollide（与 d3-force 同款，但是 1D/2D/3D 统一版）。
   * 我们用 2D 路径（nDim 由 simulation 传给 force.initialize 的第二个 arg 决定）。
   *
   * 链式 API：.radius(fn|number) / .iterations(n) / .strength(n) /
   * .initialize(nodes, random, nDim)（system 自动调，我们不主动调）。
   */
  export interface ForceCollide<NodeDatum = unknown> {
    (alpha: number): void
    radius: (radius: ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number) | number) => ForceCollide<NodeDatum>
    iterations: (iterations: number) => ForceCollide<NodeDatum>
    strength: (strength: number) => ForceCollide<NodeDatum>
    initialize?: (nodes: NodeDatum[], random?: () => number, nDim?: 1 | 2 | 3) => void
  }

  export function forceCollide<NodeDatum = unknown>(): ForceCollide<NodeDatum>
}
