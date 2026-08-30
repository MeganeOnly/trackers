// packages/tracker-ui/src/GraphView/useTreeLayout.ts
//
// 树形布局：按 prereq 链深度分层摆放 + 钉死 (fx/fy)。
//
// 坐标系：
//   - canvas 原点在左上，y 向下为正；"从下往上"在屏幕坐标系里就是 y 越小越靠上
//   - depth=0（叶）放在 y = maxDepth * layerHeight（屏幕下方）
//   - depth=max（根）放在 y = 0（屏幕上方）
//   - 同一层内按 id 排序后水平均匀分布，居中
//
// 钉死是为了"更加固定"——用户明确希望这个模式不要像力导向那样动。
// 高亮节点也保持其层级位置（不再像力导向里被钉到 (0,0)），点击高亮的"两段式居中"
// 仍由 autoCenter hook 触发，把视图平移到它的层级坐标。
//
// 与原 GraphView 的 computeDepths / applyTreeLayout 行为一致,纯抽函数搬过来。
//
// 2026-08 patch:层级下同一层节点按"该层最长 title 文本宽度 + 节点绘制直径"
// 自适应 layerWidth —— 避免短 id 节点和长 title 节点挨在同一层时,长 title 文本
// 把旁边的节点覆盖。算法:pickLayerWidth(layer, baseLayerWidth) 取层内 title 字
// 符数上限 × 8 + 节点直径 + padding,与 DEFAULT_TREE_DIMS.layerWidth 取 max。
// force 模式下的重叠由 useGraphPhysics 的 collide force 解决(2026-08 加)。

import { computeNodeRenderRadius } from './nodeRadius'
import type { BaseGraphNode, BaseGraphLink } from './types'

export interface TreeLayoutDims {
  layerHeight: number
  layerWidth: number
}

/** layerHeight / layerWidth 默认值(2026-08 review):
 *  - layerHeight 从 130 → 140:让 layer 间留出节点 title 与上方 / 下方节点的间距;
 *    130 太紧(尤其重叠 title 时上一层的节点 title 与下一层节点圆几乎贴)。
 *  - layerWidth 从 170 → 200:基础宽度增加,让"短 title"的相邻节点不会因画图
 *    比例偏小而拥挤;再由 pickLayerWidth() 按层内最大 title 字符数再放宽。 */
export const DEFAULT_TREE_DIMS: TreeLayoutDims = {
  layerHeight: 140,
  layerWidth: 200
}

/**
 * 给一层节点算"足够不重叠"的 layerWidth。
 *
 * 公式:`max(baseLayerWidth, longestTitleLen * CHARS_PER_WIDTH_PX + nodeDiameter + padding)`
 *
 *   CHARS_PER_WIDTH_PX = 8 — 11px 字号下中文 ≈ 11px/字符,英文 ≈ 6.5px/字符,
 *     混合文本估 8px/字符偏保守(长 title 占的横向像素宁多勿少)。
 *   nodeDiameter = 2 × computeNodeRenderRadius(maxRefCountNode) — 取层内最大的
 *     refCount 节点的直径(层内 min 几乎都是相同 base 半径,用 max 更稳)。
 *   padding = 24 — 节点圆与文本左右各留 12px。
 *
 * 算法细节:预测每个节点的"视觉右沿"=`titleHalf + nodeRadius`,两个相邻节点中心间
 * 距应 ≥ 双方右沿之和 + padding。再与 baseLayerWidth 取 max(短 title 仍用默认值)。
 *
 * 抽成模块内私有函数,导出 pickLayerWidthForTest 给单测直接覆盖边界。
 */
export const pickLayerWidthForTest = pickLayerWidth

function pickLayerWidth(layer: BaseGraphNode[], baseLayerWidth: number): number {
  const CHARS_PER_WIDTH_PX = 8
  const PADDING = 24
  let longestTitle = 0
  let maxR = 0
  for (const n of layer) {
    const t = (n.title ?? '').length
    if (t > longestTitle) longestTitle = t
    /* 取层内最大渲染半径 —— 用 max(直径)算层宽;层内大多数节点半径近似,
     * 略宽松不会更糟(更稀疏总比重叠好)。 */
    const r = computeNodeRenderRadius(n)
    if (r > maxR) maxR = r
  }
  const halfWidth = longestTitle * CHARS_PER_WIDTH_PX + maxR
  const adaptive = halfWidth * 2 + PADDING
  return Math.max(baseLayerWidth, adaptive)
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
 *
 * 2026-08:layerWidth 自适应 —— pickLayerWidth(layer, baseLayerWidth) 按层内最
 * 长 title 与最大节点半径决定层宽,避免长 title 节点覆盖旁边的节点。短 title
 * 仍用 baseLayerWidth(DEFAULT_TREE_DIMS.layerWidth)。每层独立计算,不同层可有
 * 不同宽度(典型:"根层 = 单节点",深度 0 的"叶层 = 多节点",但两者用同一公式)。
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
    if (n === 0) continue
    /* 2026-08:每层独立算层宽 —— 不同层节点集合不同,title 长度差异大;
     * 单点(d=单节点层)的 layerWidth 取 adaptive(标题对单点不重要,但与其他层
     * 对齐可读性更好)。 */
    const layerWidth = pickLayerWidth(layer, dims.layerWidth)
    layer.forEach((node, i) => {
      const x = (i - (n - 1) / 2) * layerWidth
      node.x = x
      node.y = y
      /* 钉死：让 d3 在 tree 模式下不再自由漂浮；切回 force 时由 mode effect 清 */
      node.fx = x
      node.fy = y
    })
  }
}
