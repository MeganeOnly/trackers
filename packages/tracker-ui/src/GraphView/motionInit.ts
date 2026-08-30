// packages/tracker-ui/src/GraphView/motionInit.ts
//
// 把 index.tsx 的 layoutMode effect 在 force 分支里的决策抽成纯函数 ——
// 便于 vitest 单测覆盖（直接挂在 React effect 上测不到，且 React effects 跑两遍
// + 异步都让测试结果不稳）。
//
// 三个出口：
//   - 'restore': 之前切到 tree/analyze 时备份过用户值 → 恢复
//   - 'init':    首次进入 force 模式（motionInitializedRef=false）→ 用 DEFAULT_MOTION
//   - 'noop':    已初始化过、且无备份 → **不动 motionRef**（防止数据变化时静默冲掉）
//
// 历史 bug 根因就在第三个分支：原版本没有 'noop' 分支,任何 visibleData 变化都会
// 走到 init 路径，把用户在 panel 里调好的 orbit/jitter/centripetal 静默覆盖回
// DEFAULT_MOTION(典型场景：开图 → panel 调到 0.2 → 加一本书 → motion 回到 0.15,
// "我刚才调的值丢失了")。
//
// 另一历史 bug(2026-08 commit):"hover 时节点被拽进中心互相覆盖"。原 init 路径下
// centripetal 在 hover 时仍用 DEFAULT_MOTION.centripetal(0.15),不参与 hover 自
// 适应。结果切向 orbit/jitter 已经停了,但 centripetal 仍以全速向心,节点全部塌
// 缩到中心。修复:init+hover=true 时 centripetal 也用 centripetalHover,与
// orbit/jitter 的 hover 处理对齐。每 tick 的 hover 自适应在 useGraphPhysics.ts
// 的 force 函数里读 pointerOverRef 完成。
//
// 历史 bug(2026-08 加 collide 后的连带变更):"MotionDecision 不带 collideRadius,
// init 路径会漏设"。MotionRef 加了 collideRadius 字段后,decideForceBranchMotion
// 的 init values / restore values 都要带 collideRadius,保证走 restore (切回
// force) 路径时用户的 collideRadius 也被恢复——而不是悄悄回到 DEFAULT_MOTION。
// collideRadius 不参与 hover 自适应 —— collision 是无 alpha 缩放的物理力,hover
// 减速只停运动,collide 的"节点不重叠"在 hover 时仍生效。

import { DEFAULT_MOTION, type MotionRef } from './useGraphPhysics'

export type MotionDecision =
  | { kind: 'noop' }
  | { kind: 'restore'; values: MotionRef }
  | { kind: 'init'; values: MotionRef }

/**
 * 决定 layoutMode effect 在 force 模式下应该怎么写 motionRef。
 *
 * @param savedMotion 切到 tree/analyze 时备份的用户值;null = 无备份
 * @param isInitialized motion 是否已经从 DEFAULT_MOTION 初始化过
 * @param hover 当前是否 pointerOver（图 hover 时 strength 降速）
 */
export function decideForceBranchMotion(
  savedMotion: MotionRef | null,
  isInitialized: boolean,
  hover: boolean
): MotionDecision {
  if (savedMotion) {
    /* 切回 force：恢复用户在切走前调的值（含 collideRadius —— restore 必须把
     * 用户切走前调过的 collideRadius 也带回来,否则被悄悄回默认）。 */
    return { kind: 'restore', values: savedMotion }
  }
  if (!isInitialized) {
    /* 首次进入 force：用 DEFAULT_MOTION（带 hover 自适应），之后不再重复 */
    return {
      kind: 'init',
      values: {
        orbit: hover ? DEFAULT_MOTION.orbitHover : DEFAULT_MOTION.orbit,
        jitter: hover ? DEFAULT_MOTION.jitterHover : DEFAULT_MOTION.jitter,
        /* centripetal 也参与 hover 自适应(2026-08 修复) —— 不然 hover 时
         * 节点会被持续拽向中心,orbit/jitter 已经停了没切向力平衡,centripetal
         * 单方面向心会把所有节点拉到 (0,0) 互相覆盖。 */
        centripetal: hover ? DEFAULT_MOTION.centripetalHover : DEFAULT_MOTION.centripetal,
        /* collideRadius 不参与 hover 自适应 —— collision 是无 alpha 缩放的物理
         * 力,hover 减速只停运动,collide 的"节点不重叠"在 hover 时仍生效。 */
        collideRadius: DEFAULT_MOTION.collideRadius
      }
    }
  }
  /* 已初始化过 + 没备份：用户没切走过布局（典型：visibleData 变化触发的重跑）
   * → 保持 motionRef 不动，绝不悄悄覆盖用户的滑条值 */
  return { kind: 'noop' }
}
