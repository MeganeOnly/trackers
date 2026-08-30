// packages/tracker-ui/src/GraphView/types.ts
//
// 共享 GraphView 的领域无关类型。两个 app 的 GraphNode / GraphLink
// 字段差异（book 有 author / tags；life 有 category / analyze 标记）
// 通过 callback 注入：app 端在 getNodeColor / getNodeLabel 等 callback
// 内访问自己的扩展字段，共享层只保证 id / title? / refCount / unlocked? /
// d3-force 所需的 x/y/vx/vy/fx/fy 字段存在。

import type { NodeObject, LinkObject } from 'react-force-graph-2d'

/**
 * 共享层要求的最低节点字段。所有 app 节点都应 extend 它：
 *
 *   - id —— d3-force-link 按 id 解析 link 的 source / target
 *   - title? —— 节点下方画的标题文本（可选；不传则只画圆点）
 *   - refCount —— 节点大小公式（被几个 link 引用）
 *   - unlocked? —— 默认 linkColor 需要（双方都解锁=灰，否则偏红）
 *   - x / y / vx / vy / fx / fy —— d3-force 读写
 *
 * 实际数据形态由 app 端定义（`type BookNode = BaseGraphNode & { ... }`），
 * 共享层 callback 用 `unknown` 类型的 node 参数（app 端自行 cast / 查找），
 * 避免 N 泛型穿透 react-force-graph 的 NodeObject / LinkObject 包装时类型爆炸。
 */
export interface BaseGraphNode {
  id: string
  title?: string
  /** 被前置引用的次数（决定节点大小） */
  refCount: number
  /** 默认 linkColor 用：双方都解锁=灰，否则偏红；app 可覆盖 getLinkColor */
  unlocked?: boolean
  /** d3-force 写入的位置 / 速度 / 钉位 */
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

/**
 * 共享层要求的最低 link 字段。source / target 在 d3-force-link
 * 初始化（`initialize` 调用）后会被物化成节点引用（id 也保留）；
 * app 端只关心 source/target 的 id，其它字段可选。
 *
 * 不强约束成 react-force-graph 的 `LinkObject<NodeT, LinkT>` 类型
 * （那样会要求 source/target 是 `string | number | NodeObject<NodeT>`）。
 * 这里用更宽松的 string | BaseGraphNode 形态，cast 留给 app 端。
 */
export interface BaseGraphLink {
  source: string | BaseGraphNode
  target: string | BaseGraphNode
}

/** d3-force 物化后的 link 形态 —— callback 拿到 link 时 source/target
 *  已经是 NodeObject（包含 x/y 等），不再只是 string id。 */
export type ResolvedLink = LinkObject<NodeObject, BaseGraphLink>