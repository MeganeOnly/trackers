// 回归测试：layoutMode effect 在 force 模式下对 motionRef 的初始化决策。
//
// 历史 bug(2026-08 commit `9c999f5` 系列尝试未修干净):
//   - useEffect 依赖 `[layoutModeProp, visibleData.nodes, visibleData.links]`
//     —— 加一本书 / 切 filter 都会让 effect 重跑
//   - 原实现 else 分支 if/else 链只考虑"restore 备份" + "init 默认",
//     漏了"已初始化过 + 无备份 → 不要碰 motionRef"这条 noop 路径
//   - 结果：用户在 panel 调到 0.2 → 加一本书 → motionRef 被打回 0.15
//
// 另一历史 bug(2026-08):"hover 时节点被拽进中心互相覆盖"
//   - DEFAULT_MOTION 注释里写 "hover 时 strength 降到 0.004",但代码只
//     在 orbit/jitter 实现了,centripetal 在 hover 时仍以全速向心
//   - 切向 orbit/jitter 停了,没有离心平衡,centripetal 单方面把节点拽
//     到 (0,0) 互相覆盖
//   - 修复:centripetal 也加 centripetalHover;init+hover 时三个力都用
//     hover 阈值
//
// 2026-08 加 collide 后的连带变更：MotionRef 加 collideRadius 字段,
// init / restore values 都要带 collideRadius；restore 必须把"用户切走
// 前调过的 collideRadius"也带回来,否则被悄悄回默认(同 orbit/jitter/
// centripetal 一样的"restore 完整快照"原则)。
//
// 这组测试用纯函数 `decideForceBranchMotion` 覆盖三个决策分支,顺便保护
// "savedMotion 优先于 init" / "init 用 hover 自适应值(含 centripetal)" /
// "noop 是关键回归" / "restore 完整带 collideRadius"。

import { describe, expect, it } from 'vitest'
import { decideForceBranchMotion } from '../motionInit'
import { DEFAULT_MOTION, type MotionRef } from '../useGraphPhysics'

/* 与 MotionRef 完整字段对齐 —— collideRadius 是 2026-08 加的字段,
 * 测试将来若想构造"用户调到非默认 collideRadius 又切到 tree 再切回 force"
 * 场景直接复用此对象。 */
const USER_VALUES: MotionRef = {
  orbit: 0.2,
  jitter: 0.1,
  centripetal: 0.05,
  collideRadius: 1.6
}

function expectRestore(d: ReturnType<typeof decideForceBranchMotion>, values: MotionRef): void {
  if (d.kind !== 'restore') throw new Error(`expected restore, got ${d.kind}`)
  expect(d.values).toEqual(values)
}

function expectInit(d: ReturnType<typeof decideForceBranchMotion>, values: MotionRef): void {
  if (d.kind !== 'init') throw new Error(`expected init, got ${d.kind}`)
  expect(d.values).toEqual(values)
}

function expectNoop(d: ReturnType<typeof decideForceBranchMotion>): void {
  expect(d.kind).toBe('noop')
}

describe('decideForceBranchMotion — 三分支决策', () => {
  it('restore: 有 savedMotion 时优先恢复备份值(切回 force 的路径)', () => {
    expectRestore(decideForceBranchMotion(USER_VALUES, true, false), USER_VALUES)
  })

  it('init: 无 savedMotion 且 isInitialized=false → 用 DEFAULT_MOTION(含 collideRadius)', () => {
    expectInit(decideForceBranchMotion(null, false, false), {
      orbit: DEFAULT_MOTION.orbit,
      jitter: DEFAULT_MOTION.jitter,
      centripetal: DEFAULT_MOTION.centripetal,
      collideRadius: DEFAULT_MOTION.collideRadius
    })
  })

  it('noop: 已初始化过 + 无备份 → 关键回归点,不返回 init', () => {
    /* 修复前这里返回 init,会把用户值静默冲掉 */
    expectNoop(decideForceBranchMotion(null, true, false))
  })

  it('restore 优先于 init(即使 isInitialized=false)', () => {
    /* 边界情况:第一次跑就碰上 savedMotion(理论上 mount 时不会发生,
     * 但代码要稳 —— restore 永远先于 init 判定) */
    expectRestore(decideForceBranchMotion(USER_VALUES, false, false), USER_VALUES)
  })

  /* 2026-08 加的回归点：restore 必须保留 collideRadius,不能丢。
   * 之前 (orbit/jitter/centripetal) 三个字段都已 restore,
   * 现在加了 collideRadius 字段后,如果 restore.values 漏带这个字段,
   * "切回 force 后碰撞半径被静默回默认" —— 用户以为切走前调的 1.6 没生效。 */
  it('restore: 完整保留 collideRadius(用户切走前的值回到 motionRef)', () => {
    expectRestore(decideForceBranchMotion(USER_VALUES, true, false), USER_VALUES)
    /* 直接断言 collideRadius 已被 restore 保留 —— 不用 toEqual 全量,
     * 防止未来 motionRef 加更多字段时这条测试脆 */
    const d = decideForceBranchMotion(USER_VALUES, true, false)
    if (d.kind !== 'restore') throw new Error('expected restore')
    expect(d.values.collideRadius).toBe(1.6)
  })
})

describe('decideForceBranchMotion — hover 自适应', () => {
  it('init + hover=true → orbit/jitter/centripetal 都用 hover 阈值', () => {
    /* 修复 hover 塌缩 bug 后:centripetal 也参与 hover 自适应。
     * 原版这里 centripetal = DEFAULT_MOTION.centripetal (0.15),hover 时
     * 节点被持续向心拽到中心互相覆盖。 */
    expectInit(decideForceBranchMotion(null, false, true), {
      orbit: DEFAULT_MOTION.orbitHover,
      jitter: DEFAULT_MOTION.jitterHover,
      centripetal: DEFAULT_MOTION.centripetalHover,
      collideRadius: DEFAULT_MOTION.collideRadius
    })
  })

  it('init + hover=false → 用全速默认', () => {
    expectInit(decideForceBranchMotion(null, false, false), {
      orbit: DEFAULT_MOTION.orbit,
      jitter: DEFAULT_MOTION.jitter,
      centripetal: DEFAULT_MOTION.centripetal,
      collideRadius: DEFAULT_MOTION.collideRadius
    })
  })

  it('hover 标志对 noop 无影响(noop 不写 motionRef,hover 不参与)', () => {
    expectNoop(decideForceBranchMotion(null, true, true))
    expectNoop(decideForceBranchMotion(null, true, false))
  })

  it('hover 标志对 restore 无影响(restore 始终原样返回备份值)', () => {
    expectRestore(decideForceBranchMotion(USER_VALUES, true, true), USER_VALUES)
    expectRestore(decideForceBranchMotion(USER_VALUES, true, false), USER_VALUES)
  })

  /* 2026-08 加的回归点: collideRadius 不参与 hover 自适应。 collision 是
   * "节点不重叠"的硬约束,与"图缓慢旋转便于命中"的 hover 减速是两个目标:
   * 哪怕 hover 时图冻结,碰撞仍然应当让节点不互相覆盖。这里用断言
   * "无论 hover 是 true 还是 false,init 时 collideRadius 都等于默认值"
   * 来锁住这个设计意图。 */
  it('collideRadius 不参与 hover 自适应(hover 时仍用 DEFAULT_MOTION.collideRadius)', () => {
    const noHover = decideForceBranchMotion(null, false, false)
    const hover = decideForceBranchMotion(null, false, true)
    if (noHover.kind !== 'init' || hover.kind !== 'init') throw new Error('expected init')
    expect(noHover.values.collideRadius).toBe(DEFAULT_MOTION.collideRadius)
    expect(hover.values.collideRadius).toBe(DEFAULT_MOTION.collideRadius)
  })
})

describe('decideForceBranchMotion — 与 DEFAULT_MOTION 常量一致', () => {
  /* 防 DEFAULT_MOTION 改了值忘了同步这里 —— 测试要"硬"挂上具体数字,
   * 不能只 expect(DEFAULT_MOTION.orbit) 那样空转 */
  it('init 数值与 DEFAULT_MOTION 当前常量绑定', () => {
    const d = decideForceBranchMotion(null, false, false)
    expect(d.kind).toBe('init')
    if (d.kind !== 'init') return
    expect(d.values.orbit).toBe(0.35)
    expect(d.values.jitter).toBe(0.25)
    expect(d.values.centripetal).toBe(0.08)
    expect(d.values.collideRadius).toBe(1.0)
  })

  it('hover init 数值与 DEFAULT_MOTION hover 常量绑定(含 centripetal)', () => {
    const d = decideForceBranchMotion(null, false, true)
    expect(d.kind).toBe('init')
    if (d.kind !== 'init') return
    expect(d.values.orbit).toBe(0.004)
    expect(d.values.jitter).toBe(0.004)
    /* 2026-08 修复后:centripetal 也用 hover 阈值 0.004,
     * 防止 hover 时节点被向心力持续拽到中心互相覆盖。 */
    expect(d.values.centripetal).toBe(0.004)
    /* 2026-08 加 collide 后:hover 不影响 collideRadius,仍用 DEFAULT 值 */
    expect(d.values.collideRadius).toBe(1.0)
  })
})
