// packages/tracker-ui/src/GraphView/__tests__/useInitialZoom.test.ts
//
// computeInitialZoom 公式锁死 —— 防止 v11 (2026-08) 改 INITIAL_ZOOM_FACTOR /
// INITIAL_ZOOM_FLOOR / INITIAL_ZOOM_CAP 时漏同步文档注释或 dev-notes。
// 用户已经看了几轮初始 zoom,公式的具体系数对"图打开后看着多大"是直接
// 视觉信号,不能让其悄悄漂移。

import { describe, expect, it } from 'vitest'
import {
  computeInitialZoom,
  INITIAL_ZOOM_FACTOR,
  INITIAL_ZOOM_FLOOR,
  INITIAL_ZOOM_CAP
} from '../useInitialZoom'

describe('computeInitialZoom — v12 (2026-08)', () => {
  /* 几个典型节点数 —— 必须与 useInitialZoom.ts 头注释里的对照表完全一致,
   * 那张表是 dev-notes.md v11/v12 条目里也给过的"用户视觉对照"。
   * v12 把因子从 6 提到 8、cap 从 2.0 提到 2.5,典型节点数对照表: */
  it('N=8 时 cap 在 2.5(8/2=4.0 → clamp 到上限)', () => {
    expect(computeInitialZoom(8)).toBeCloseTo(2.5, 5)
    expect(computeInitialZoom(8)).toBe(INITIAL_ZOOM_CAP)
  })

  it('N=27 时也被 cap 在 2.5(8/3 ≈ 2.67 → clamp)', () => {
    /* 典型用户节点数 ~27,v11 是 2.0 刚好未到 cap;v12 用更激进的 cap
     * 让典型图也能拉到 2.5,满足"默认再大一点"诉求 */
    expect(computeInitialZoom(27)).toBeCloseTo(2.5, 5)
  })

  it('N=64 时 2.0(8/4 = 2.0,无需 clamp)', () => {
    expect(computeInitialZoom(64)).toBeCloseTo(2.0, 5)
  })

  it('N=216 时 1.33(8/6 ≈ 1.33)', () => {
    expect(computeInitialZoom(216)).toBeCloseTo(1.33, 2)
  })

  it('N=512 时 1.0(8/8 = 1.0,到 floor 不再放大)', () => {
    expect(computeInitialZoom(512)).toBeCloseTo(1.0, 5)
    expect(computeInitialZoom(512)).toBe(INITIAL_ZOOM_FLOOR)
  })

  it('空图 (N=0) 兜底到 floor 1.0,避免除零或负数', () => {
    expect(computeInitialZoom(0)).toBe(INITIAL_ZOOM_FLOOR)
  })

  it('极大图 (N=10000) 也兜底到 floor 1.0 —— 大图不再放大', () => {
    expect(computeInitialZoom(10000)).toBe(INITIAL_ZOOM_FLOOR)
  })

  it('小图区间单调: N 越大 zoom 越小(不超过 cap)', () => {
    const z8 = computeInitialZoom(8)
    const z27 = computeInitialZoom(27)
    const z64 = computeInitialZoom(64)
    /* N=8 和 N=27 都被 cap 在 2.5,数值相等;N=27 之后单调下降 */
    expect(z8).toBe(z27)
    expect(z27).toBeGreaterThan(z64)
  })

  it('硬挂系数常量: 8 / 2.5 / 1.0', () => {
    /* 防"改了 INITIAL_ZOOM_FACTOR 忘了同步这里"——同 motionInit.test.ts
     * "与 DEFAULT_MOTION 常量一致"那组测试的口径。 */
    expect(INITIAL_ZOOM_FACTOR).toBe(8)
    expect(INITIAL_ZOOM_CAP).toBe(2.5)
    expect(INITIAL_ZOOM_FLOOR).toBe(1.0)
  })
})