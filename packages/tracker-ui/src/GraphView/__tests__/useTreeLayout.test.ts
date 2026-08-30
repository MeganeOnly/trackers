// packages/tracker-ui/src/GraphView/__tests__/useTreeLayout.test.ts
//
// 单元测试：computeDepths / applyTreeLayout / pickLayerWidth。
//
// 覆盖重点（2026-08 overlap 修复 patch）：
//   1) pickLayerWidth 取层内"最长 title × 8 + 节点半径 + padding" 与 baseLayerWidth 取 max
//   2) 短 title 仍用 baseLayerWidth（不会无谓加宽）
//   3) 长 title 自动加宽（避免节点视觉重叠）
//   4) 大 refCount 节点半径变化不显著（典型 refCount ≤ 20 时半径 ≈ 8-14px），
//      主要受 title 长度影响 —— 但测试也要保护"max radius 也会参与决定"
//
// computeDepths 覆盖：基础环检测、单链、多叉。 applyTreeLayout 覆盖：同层 id 排序、
// 钉死 fx/fy、layerWidth 自适应。

import { describe, expect, it } from 'vitest'
import type { BaseGraphNode, BaseGraphLink } from '../types'
import {
  computeDepths,
  applyTreeLayout,
  DEFAULT_TREE_DIMS,
  pickLayerWidthForTest
} from '../useTreeLayout'

function n(id: string, opts: { title?: string; refCount?: number } = {}): BaseGraphNode {
  return { id, title: opts.title ?? id, refCount: opts.refCount ?? 0 }
}

function lk(src: string, tgt: string): BaseGraphLink {
  return { source: src, target: tgt }
}

/** 用 title.length + maxR 自推 picker 输出，避免在测试里硬数字符数（CJK
 *  数起来容易出错 + 系统字体宽度估值未来可能调整）。 */
function expectedPickerAdaptive(layer: BaseGraphNode[], baseLayerWidth: number): number {
  let longestTitle = 0
  let maxR = 0
  for (const n of layer) {
    const t = (n.title ?? '').length
    if (t > longestTitle) longestTitle = t
    /* 与 nodeRadius.ts 的 computeNodeRenderRadius 公式一致 —— 测试也用同一
     * 公式心算 maxR，避免 refCount 与对应 sqrt 不一致时测试找不到正确值。 */
    const val = 1 + Math.sqrt(n.refCount) * 2
    const r = Math.sqrt(Math.max(0, val)) * 4
    if (r > maxR) maxR = r
  }
  const halfWidth = longestTitle * 8 + maxR
  const adaptive = halfWidth * 2 + 24
  return Math.max(baseLayerWidth, adaptive)
}

describe('pickLayerWidth — title 长度驱动', () => {
  it('纯 baseLayerWidth：title 短 / 单点 → 仍用默认 200', () => {
    const layer: BaseGraphNode[] = [
      n('a', { title: 'A' }),
      n('b', { title: 'B' })
    ]
    expect(pickLayerWidthForTest(layer, DEFAULT_TREE_DIMS.layerWidth)).toBe(200)
  })

  it('长 title → layerWidth 自动放大（用 .length 自推期望值）', () => {
    const layer: BaseGraphNode[] = [
      n('a', { title: '百年孤独：一个家族在马孔多的百年兴衰' }),
      n('b', { title: '短' })
    ]
    const expected = expectedPickerAdaptive(layer, DEFAULT_TREE_DIMS.layerWidth)
    /* sanity: 自推数值 > base 才算"放大生效" */
    expect(expected).toBeGreaterThan(DEFAULT_TREE_DIMS.layerWidth)
    expect(pickLayerWidthForTest(layer, DEFAULT_TREE_DIMS.layerWidth)).toBe(expected)
  })

  it('空 title(节点没设置 title)== 极短 title（长度差异都在 padding 内被吸收）', () => {
    const withEmpty: BaseGraphNode[] = [n('a', { title: '' }), n('b', { title: '' })]
    const withOne: BaseGraphNode[] = [n('a', { title: 'A' }), n('b', { title: 'B' })]
    /* 短 title 时 adaptive < 200 → 用 base */
    expect(pickLayerWidthForTest(withEmpty, 200)).toBe(200)
    expect(pickLayerWidthForTest(withOne, 200)).toBe(200)
  })

  it('baseLayerWidth 自带 800 时不能缩（数学 max 而非 min）', () => {
    /* pickLayerWidth 用 Math.max → 即使 adaptive < 800 也保持 800 */
    const layer: BaseGraphNode[] = [n('a', { title: 'A' })]
    expect(pickLayerWidthForTest(layer, 800)).toBe(800)
  })

  it('用自定义 baseLayerWidth 时仍生效', () => {
    const layer: BaseGraphNode[] = [n('a', { title: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })]
    const expected = expectedPickerAdaptive(layer, 100)
    expect(expected).toBeGreaterThan(400)
    expect(pickLayerWidthForTest(layer, 100)).toBe(expected)
  })
})

describe('pickLayerWidth — 节点半径参与计算', () => {
  it('高 refCount 节点单独时不增加 layerWidth(只单点)', () => {
    /* 单节点 layerWidth 等于 (节点圆左右视觉宽度) × 2 + padding,
     * 即使是 refCount=25 的"高连接节点"(半径 ≈ 14.8px)
     * adaptive ≈ 14.8*2 + 24 = 53.6 < 200 → 用 base */
    const bigNode = n('hero', { title: 'X', refCount: 25 })
    expect(pickLayerWidthForTest([bigNode], 200)).toBe(200)
  })

  it('"层内最大半径节点" 与 "最长 title" 取 max —— 二者都参与判定', () => {
    const layer: BaseGraphNode[] = [
      n('longBranch', { title: '三十年河东三十年河西莫欺少年穷' }),
      n('shortBranch', { title: 'X', refCount: 36 })  // radius ≈ sqrt(1+12)*4 ≈ 16
    ]
    const expected = expectedPickerAdaptive(layer, 200)
    expect(expected).toBeGreaterThan(DEFAULT_TREE_DIMS.layerWidth)
    expect(pickLayerWidthForTest(layer, 200)).toBe(expected)
  })
})

describe('applyTreeLayout — 自适应层宽与钉位协同', () => {
  it('同层两个节点：x 间距由 pickLayerWidth 决定', () => {
    const nodes: BaseGraphNode[] = [
      n('a', { title: '长长长长长长长长长长长长长长长长长长长长长' }),
      n('b', { title: '另一个' })
    ]
    const depths = new Map<string, number>([['a', 0], ['b', 0]])
    applyTreeLayout(nodes, depths, DEFAULT_TREE_DIMS)
    const expectedLayerWidth = expectedPickerAdaptive(nodes, DEFAULT_TREE_DIMS.layerWidth)
    /* layerWidth = pickLayerWidth(...) 决定两节点 x 间距 */
    expect(nodes[0].x).toBe(-expectedLayerWidth / 2)
    expect(nodes[1].x).toBe(expectedLayerWidth / 2)
    /* fx 钉死 */
    expect(nodes[0].fx).toBe(nodes[0].x)
    expect(nodes[0].fy).toBe(0)
  })

  it('不同层独立算层宽（不同 title 长度 → 不同 layerWidth）', () => {
    const nodes: BaseGraphNode[] = [
      n('leaf1', { title: 'xxx' }),
      n('leaf2', { title: 'yyy' }),
      n('top', { title: '三十年河东三十年河西莫欺少年穷' })
    ]
    /* leaf1/leaf2 在 depth 0, top 在 depth 1 */
    const depths = new Map<string, number>([
      ['leaf1', 0], ['leaf2', 0], ['top', 1]
    ])
    applyTreeLayout(nodes, depths, DEFAULT_TREE_DIMS)
    const leaf1 = nodes.find((x) => x.id === 'leaf1')!
    const leaf2 = nodes.find((x) => x.id === 'leaf2')!
    const leafLayerWidth = expectedPickerAdaptive([leaf1, leaf2], DEFAULT_TREE_DIMS.layerWidth)
    /* depth=0 layer */
    expect(Math.abs(leaf1.x! - leaf2.x!)).toBe(leafLayerWidth)
    /* depth=1 layer — 单点 (top)，i=0,n=1 → x = (0 - 0)*layerWidth = 0,
     * y = (maxDepth - 1) * layerHeight = (1 - 1) * 140 = 0 */
    const top = nodes.find((x) => x.id === 'top')!
    expect(top.x).toBe(0)
    expect(top.y).toBe(0)
  })

  it('同层按 id 排序，节点增删不乱跳（layerWidth 自适应后仍按 sorted order 排）', () => {
    const nodes: BaseGraphNode[] = [
      n('z', { title: 'A' }),
      n('a', { title: 'A' }),
      n('m', { title: 'A' })
    ]
    const depths = new Map<string, number>([['z', 0], ['a', 0], ['m', 0]])
    applyTreeLayout(nodes, depths, DEFAULT_TREE_DIMS)
    /* 按 id localeCompare 排序: a, m, z */
    const sorted = [...nodes].sort((p, q) => p.id.localeCompare(q.id))
    const layerWidth = expectedPickerAdaptive(nodes, DEFAULT_TREE_DIMS.layerWidth)
    expect(sorted.map((n) => n.x)).toEqual([-layerWidth, 0, layerWidth])
  })

  it('每层都钉死 fx/fy（force 模式切回时不漂浮）', () => {
    const nodes: BaseGraphNode[] = [n('root', { title: 'A' }), n('leaf', { title: 'A' })]
    const depths = new Map<string, number>([['root', 1], ['leaf', 0]])
    applyTreeLayout(nodes, depths)
    for (const x of nodes) {
      expect(x.fx).toBe(x.x)
      expect(x.fy).toBe(x.y)
      expect(typeof x.fx).toBe('number')
    }
  })

  it('computeDepths 与 applyTreeLayout 联合:多叉链', () => {
    /* A → B, A → C, B → D, C → D
     *  depth(A)=0, depth(B)=1, depth(C)=1, depth(D)=2 */
    const nodes: BaseGraphNode[] = [
      n('A', { title: 'A' }),
      n('B', { title: 'B' }),
      n('C', { title: 'C' }),
      n('D', { title: 'D' })
    ]
    const links: BaseGraphLink[] = [
      lk('A', 'B'),
      lk('A', 'C'),
      lk('B', 'D'),
      lk('C', 'D')
    ]
    const depths = computeDepths(nodes, links)
    expect(depths.get('A')).toBe(0)
    expect(depths.get('B')).toBe(1)
    expect(depths.get('C')).toBe(1)
    expect(depths.get('D')).toBe(2)

    applyTreeLayout(nodes, depths, DEFAULT_TREE_DIMS)
    /* y 公式: (maxDepth - d) * layerHeight = (2 - d) * 140
     *   A: (2-0)*140 = 280 (屏幕下方, 叶子层)
     *   B/C: (2-1)*140 = 140 (中)
     *   D: (2-2)*140 = 0 (屏幕上方, 根层) */
    expect(nodes.find((x) => x.id === 'A')!.y).toBe(280)
    expect(nodes.find((x) => x.id === 'B')!.y).toBe(140)
    expect(nodes.find((x) => x.id === 'C')!.y).toBe(140)
    expect(nodes.find((x) => x.id === 'D')!.y).toBe(0)
  })

  it('computeDepths 环检测:环上节点不挂死、深度是有限数字', () => {
    /* A → B → A 形成环。 A 和 B 都是环上节点。visiting 集合发现回边时
     * 把那条边视为 0,避免无限递归 —— 验证不挂死 + 返回的数字有限。 */
    const nodes: BaseGraphNode[] = [n('A'), n('B')]
    const links: BaseGraphLink[] = [lk('A', 'B'), lk('B', 'A')]
    const depths = computeDepths(nodes, links)
    expect(typeof depths.get('A')).toBe('number')
    expect(typeof depths.get('B')).toBe('number')
    expect(Number.isFinite(depths.get('A')!)).toBe(true)
    expect(Number.isFinite(depths.get('B')!)).toBe(true)
  })
})
