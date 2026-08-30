// packages/tracker-ui/src/GraphView/useGraphPath.ts
//
// A→B 路径跟踪 —— BFS 沿 unlock 方向（前置→后置）找最短路径。
//
// 数据流：
//   - endpoints { a, b } 由 app 端 useState 管理
//   - getForward(id): id 的直接下游（解锁图里 = 我作为前置，指向谁）
//     共享层不感知 unlock 语义；app 端构造
//   - 返回 pathNodes: string[]（含 a, b）/ pathEdges: Set<string>（"src->->id" 形式）
//
// 路径不存在返回 null（共享层渲染"无路径"提示）。
//
// 算法 BFS：O(V + E)，适合小图（< 500 节点）。
// 不用 Dijkstra（边权都是 1）。
//
// 不支持环检测：环上节点 visited 后不会重复访问，但 BFS 找到的最短路径可能不是最优
//（绕过环）。这对 unlock 图来说够用，因为 unlock 图已经做了环检测（环上节点置未解锁）。

import { useMemo } from 'react'

export interface PathEndpoints {
  a: string | null
  b: string | null
}

export interface GraphPathResult {
  /** null = 无路径；数组 = 路径节点序列（含 a 和 b） */
  pathNodes: string[] | null
  /** 路径上的边，key = "src->->tgt" */
  pathEdges: Set<string>
  /** BFS 不可达（B 为 null / a === b）= false */
  reachable: boolean
}

export function useGraphPath(
  endpoints: PathEndpoints,
  getForward: (id: string) => string[]
): GraphPathResult {
  return useMemo(() => {
    const { a, b } = endpoints
    if (!a || !b) {
      return { pathNodes: null, pathEdges: new Set(), reachable: false }
    }
    if (a === b) {
      return { pathNodes: [a], pathEdges: new Set(), reachable: true }
    }
    /* BFS from a → b 沿 forward 方向 */
    const queue: string[][] = [[a]]
    const visited = new Set<string>([a])
    let found: string[] | null = null
    while (queue.length > 0) {
      const path = queue.shift()!
      const last = path[path.length - 1]
      const nexts = getForward(last)
      for (const n of nexts) {
        if (n === b) {
          found = [...path, n]
          break
        }
        if (!visited.has(n)) {
          visited.add(n)
          queue.push([...path, n])
        }
      }
      if (found) break
    }
    if (!found) {
      return { pathNodes: null, pathEdges: new Set(), reachable: false }
    }
    /* 构造 pathEdges：每对相邻节点间的边 */
    const pathEdges = new Set<string>()
    for (let i = 0; i < found.length - 1; i++) {
      pathEdges.add(`${found[i]}->->${found[i + 1]}`)
    }
    return { pathNodes: found, pathEdges, reachable: true }
  }, [endpoints.a, endpoints.b, getForward])
}