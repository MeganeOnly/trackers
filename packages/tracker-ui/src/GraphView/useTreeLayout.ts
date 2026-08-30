// packages/tracker-ui/src/GraphView/useTreeLayout.ts
//
// 树形布局：按 prereq 链深度分层摆放 + 钉死 (fx/fy)。
//
// 坐标系：
//   - canvas 原点在左上，y 向下为正；"从下往上"在屏幕坐标系里就是 y 越小越靠上
//   - depth=0（叶）放在 y = maxDepth * layerHeight（屏幕下方）
//   - depth=maxDepth（根）放在 y = 0（屏幕上方）
//   - 同一层内按 id 排序后水平均匀分布，居中
//
// 钉死是为了"更加固定"——用户明确希望这个模式不要像力导向那样动。
// 高亮节点也保持其层级位置（不再像力导向里被钉到 (0,0)），点击高亮的"两段式居中"
// 仍由 autoCenter hook 触发，把视图平移到它的层级坐标。
//
// 与原 GraphView 的 computeDepths / applyTreeLayout 行为一致，纯抽函数搬过来。

import type { BaseGraphNode, BaseGraphLink } from './types'

export interface TreeLayoutDims {
  layerHeight: number
  layerWidth: number
}

export const DEFAULT_TREE_DIMS: TreeLayoutDims = {
  layerHeight: 130,
  layerWidth: 170
}

/**
 * 计算每个节点的"深度"：以"前置依赖链"长度为单位。
 *
 * 语义对齐用户的层级布局需求："从下往上越来越后置"——
 *   - depth=0 的节点 = 叶子 = 无前置（最底层、最初的"前置"任务）
 *   - depth=max 的节点 = 根 = 没有依赖其上的任务（最顶层、最"后置"的总目标）
 *
 * 用 DFS 沿 dependsOn 边向下走，深度 = max(prereq 深度) + 1。
 * 环检测：visiting 集合发现回边时返回 0（环上节点的深度按"已访问的非环 prereq"
 * 算，避免无限递归）。环上深度相同会导致它们叠在同一层——
 * 这与"层级模式是确定性位置"的语义冲突但不致命，视觉上能看出"这几个扎堆了"。
 */
export function computeDepths(nodes: BaseGraphNode[], links: BaseGraphLink[]): Map<string, number> {
  const dependsOn = new Map<string, Set<string>>()
  for (const n of nodes) dependsOn.set(n.id, new Set())
  for (const l of links) {
    const srcId = typeof l.source === 'string' ? l.source : (l.source as BaseGraphNode).id
    const tgtId = typeof l.target === 'string' ? l.target : (l.target as BaseGraphNode).id
    if (dependsOn.has(tgtId)) dependsOn.get(tgtId)!.add(srcId)
  }

  const depth = new Map<string, number>()
  const visiting = new Set<string>()

  const getDepth = (id: string): number => {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0 /* 环：把这条边视为"已断"，避免无限递归 */
    visiting.add(id)

    const prereqs = dependsOn.get(id) ?? new Set<string>()
    let maxD = 0
    for (const p of prereqs) {
      const d = getDepth(p)
      if (d > maxD) maxD = d
    }
    const result = prereqs.size === 0 ? 0 : maxD + 1
    depth.set(id, result)
    visiting.delete(id)
    return result
  }

  for (const n of nodes) getDepth(n.id)
  return depth
}

/**
 * 树形布局：按 depth 分层摆放 + 钉死 (fx/fy)。
 *
 * 同层按 id 排序，节点增删时位置不会乱跳。
 */
export function applyTreeLayout(
  nodes: BaseGraphNode[],
  depths: Map<string, number>,
  dims: TreeLayoutDims = DEFAULT_TREE_DIMS
): void {
  const byDepth = new Map<number, BaseGraphNode[]>()
  for (const n of nodes) {
    const d = depths.get(n.id) ?? 0
    let arr = byDepth.get(d)
    if (!arr) {
      arr = []
      byDepth.set(d, arr)
    }
    arr.push(n)
  }

  let maxDepth = 0
  for (const d of byDepth.keys()) if (d > maxDepth) maxDepth = d

  for (const [d, layer] of byDepth.entries()) {
    const y = (maxDepth - d) * dims.layerHeight
    /* 同层按 id 排序，节点增删时位置不会乱跳 */
    layer.sort((a, b) => a.id.localeCompare(b.id))
    const n = layer.length
    layer.forEach((node, i) => {
      const x = (i - (n - 1) / 2) * dims.layerWidth
      node.x = x
      node.y = y
      /* 钉死：让 d3 在 tree 模式下不再自由漂浮；切回 force 时由 mode effect 清 */
      node.fx = x
      node.fy = y
    })
  }
}