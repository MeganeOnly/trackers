// packages/tracker-ui/src/GraphView/__tests__/nodeRadius.test.ts
//
// 单元测试：computeNodeRenderRadius —— 与 react-force-graph-2d 的 paintNodes
// 公式保持一致 (issue 修复的核心:碰撞半径必须等于绘制半径,否则画完后看上去
// 挨着的两个节点 collision force 看时已经叠在一起)。
//
// 关键边界：
//   - refCount=0 → val=1 → radius=4 (nodeRelSize)
//   - refCount=4 → val=1+4=5 → radius=sqrt(5)*4 ≈ 8.94
//   - refCount=25 → val=1+10=11 → radius=sqrt(11)*4 ≈ 13.27
//   - refCount 必须 ≥ 0 (无效负数会让 sqrt 拿到 NaN,这里不保护,Math.sqrt 自身处理)

import { describe, expect, it } from 'vitest'
import { computeNodeRenderRadius, NODE_REL_SIZE } from '../nodeRadius'
import type { BaseGraphNode } from '../types'

function n(refCount: number): BaseGraphNode {
  return { id: String(refCount), refCount }
}

describe('computeNodeRenderRadius — 与 react-force-graph 渲染公式一致', () => {
  it('refCount=0 → 半径 = nodeRelSize(默认值 4)', () => {
    /* val = 1 + sqrt(0)*2 = 1; r = sqrt(1)*4 = 4 */
    expect(NODE_REL_SIZE).toBe(4)
    expect(computeNodeRenderRadius(n(0))).toBe(4)
  })

  it('refCount=1 → 半径 = sqrt(3) × 4', () => {
    /* val = 1 + 1*2 = 3; r = sqrt(3)*4 */
    expect(computeNodeRenderRadius(n(1))).toBeCloseTo(Math.sqrt(3) * 4, 5)
  })

  it('refCount=4 → 半径 = sqrt(5) × 4', () => {
    /* val = 1 + 2*2 = 5; r = sqrt(5)*4 */
    expect(computeNodeRenderRadius(n(4))).toBeCloseTo(Math.sqrt(5) * 4, 5)
  })

  it('refCount=9 → 半径 = sqrt(7) × 4 (大值时仍然在合理范围)', () => {
    /* val = 1 + 3*2 = 7; r = sqrt(7)*4 ≈ 10.58 */
    expect(computeNodeRenderRadius(n(9))).toBeCloseTo(Math.sqrt(7) * 4, 5)
    expect(computeNodeRenderRadius(n(9))).toBeLessThan(16) /* 物理半径上限 ≈ 16 */
  })

  it('半径随 refCount 单调递增', () => {
    let prev = -1
    for (let i = 0; i <= 25; i++) {
      const r = computeNodeRenderRadius(n(i))
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
  })

  it('实数值 refCount（不是整数）—— 例如 3.5 — 取 sqrt 处理正常', () => {
    /* refCount 在 graph 里都是整数,但保持类型放宽 (refCount: number) */
    const r = computeNodeRenderRadius(n(3.5))
    /* val = 1 + sqrt(3.5)*2 ≈ 4.74; r = sqrt(4.74)*4 ≈ 8.71 */
    expect(r).toBeCloseTo(Math.sqrt(1 + Math.sqrt(3.5) * 2) * 4, 5)
  })

  /* Math.sqrt 对负数返回 NaN,但本函数不主动 sanitize refCount
   * —— 业务层（computeUnlocked / store）对 refCount 计数应当为非负整数。
   * 这一条作为"故意不修"的契约测试：refCount = -1 应当返回 NaN,
   * 调用方需要自己保证输入合法性。 */
  it('refCount 为负数 — 不 sanitize,返回 NaN（业务层负责保证合法）', () => {
    const r = computeNodeRenderRadius(n(-1))
    expect(Number.isNaN(r)).toBe(true)
  })
})
