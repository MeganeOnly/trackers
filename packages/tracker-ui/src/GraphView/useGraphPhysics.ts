// packages/tracker-ui/src/GraphView/useGraphPhysics.ts
//
// 力导向物理注册：orbit / jitter / centripetal 三个自定义 d3 force，
// 加上 charge 强度调节 + pointerOver 自适应 + collide force（2026-08 加）。
//
// 来自两 app 原 GraphView.tsx 的物理部分（行为完全一致，注释收敛）。
// 关键设计：
//
// 1) orbit 是切向速度（绕中心(0,0)旋转），让节点一直缓慢运动——
//    d3-force 的 charge / link / center 是保守力，alpha 多高都不能让平衡态再动；
//    给每个节点持续加切向速度，整张图变成缓慢旋转的云，永远有运动但不抽搐。
// 2) centripetal 是径向向心（拉向中心），让轨道半径被收小，视觉更紧凑。
// 3) jitter 是小幅度随机噪声，让旋转不呆板；强度必须小。
// 4) 鼠标在图上时把 orbit/jitter/centripetal 降到接近 0——图"停住"才能稳定命中：
//    react-force-graph 的 hover/点击命中靠一张 800ms 才刷新一次的 shadow canvas,
//    节点一直高速运动时点击会落空（点到可见位置、命中却在别处），甚至被当成拖拽。
// 5) collide force（2026-08 加）—— d3-force-3d 的 forceCollide，让节点之间保持
//    最小视觉间距。半径 = computeNodeRenderRadius(n) × collideRadius × (isSearchActive
//    ? 1.6 : 1)，与 react-force-graph 实际画出的圆同步。节点之间"按物理排斥"
//    时，碰撞半径与绘制半径一致 → 画完后看上去挨着的两个节点不再互相覆盖；
//    之前的版本没有 collide，只靠 charge（1/r²），密度大时压不住，于是两个节点
//    画出来会在视觉上完全叠在一起。
//
// 强度用闭包注入（motionRef 改值即可，无需重新注册 force）。

import { useEffect, useRef } from 'react'
import { forceCollide } from 'd3-force-3d'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import type { BaseGraphNode, BaseGraphLink } from './types'
import { computeNodeRenderRadius } from './nodeRadius'

/** 默认物理参数
 *
 *  d3-force 积分(README 确认):每 tick 顺序为
 *  forces(alpha) → vx *= (1 - velocityDecay) → x += vx。
 *  对一个"每 tick 给 vx 加 strength"的自定义 force,稳态速度为
 *    v_ss = ((1 - velocityDecay) / velocityDecay) * strength   [单位:像素/tick]
 *  60 fps 下: v_px_s ≈ 60 * ((1 - d) / d) * strength
 *
 *  历史:
 *  - v1 (orbit=0.05/0.04/0.02 + d=0.4):稳态 0.075/tick ≈ 4.5 px/s,看不到
 *  - v2 (orbit=0.12/0.08/0.04 + d=0.4):稳态 0.18/tick ≈ 10.8 px/s,仍偏慢
 *  - v3 (orbit=0.15/0.15/0.075 + d=0.4):稳态 0.225/tick ≈ 13.5 px/s,用户
 *    仍反馈「图不动」(150px 半径上约 70 秒/圈)
 *  - v4 (orbit=0.35/0.25/0.15 + d=0.3):稳态切向 ≈ 49 px/s(约 19 秒
 *    /圈 @150px 半径)、jitter RMS ≈ 3 px/s(有机感但不抽)、centripetal
 *    径向速度 ≈ 21 px/s(配合 charge 拉紧轨道半径)。低 velocityDecay 让运
 *    动更持久。
 *  - v5(2026-08):加 centripetalHover —— 修复"hover 时节点向中心塌缩成
 *    一坨"bug。鼠标进图时 orbit/jitter/centripetal 三个力 strength 都降
 *    到 hover 值(0.004),图完全冻结,不互相挤压;原 v4 漏了 centripetal,
 *    鼠标进图后 centripetal 仍以 0.15 全速拽节点进中心,orbit/jitter
 *    ≈0 又没切向力平衡,结果所有节点被拉到中心互相覆盖。ForceParamsPanel
 *    的 RANGES 与本常量协调(尤其是 max)。
 *  - v6(2026-08):加 collide force —— 修复"节点间没有实体碰撞、密度大
 *    时互相覆盖"bug。注册 d3-force-3d 的 forceCollide,radius = 节点绘
 *    制半径(computeNodeRenderRadius)× collideRadius (默认 1.0 = 完全
 *    等于绘制半径)。strength=1、iterations=2(d3 默认是 1 — 加到 2 是为
 *    了密集场景收敛更稳)。用户拖面板 collideRadius 滑条 [0.5, 2.5] 来
 *    调密度:1.0=与绘制半径刚好贴、0.5=允许挤压一半、2.5=强制 2.5×
 *    间距。collide 与 hover 自适应正交 —— hover 让运动停下, collide
 *    在每帧仍按当前半径硬推,密集场景慢镜头反而便于命中。
 *  - v7(2026-08):默认 centripetal 从 0.15 降到 0.08 —— 用户反馈
 *    默认向心力偏强、节点被拉得太紧,orbit 主导观感被压住。降到 0.08
 *    后径向漂移 ≈ 11 px/s(vs 原 21 px/s),轨道半径视觉上往外松一档,
 *    centripetal 退居"轻微收紧"的角色;RANGES.centripetal max 保持 0.25
 *    不变 —— 用户仍可在 panel 拖到原默认的 1.7×。hover 自适应值
 *    (centripetalHover=0.004)不动 —— 冻结语义与默认大小正交。
 *
 *  hover 时 strength 降到 0.004: d=0.3 下 v_ss ≈ 0.004 * 2.33 ≈ 0.009/tick
 *  ≈ 0.55 px/s,基本静止,鼠标一上图就停稳,不影响点击命中。
 *
 *  用户拖到 0 时让节点静止;拖到 max(0.6) 时 orbit 稳态 ≈ 84 px/s(约 11
 *  秒/圈)。ForceParamsPanel 的 RANGES 必须与本常量协调(尤其是 max)。 */
export const DEFAULT_MOTION = {
  orbit: 0.35,
  jitter: 0.25,
  centripetal: 0.08,
  /** pointerOver 时降到接近 0(force 函数内部 min(用户值, hover 默认值))
   *  d=0.3 下 v_ss ≈ 0.004 * 2.33 ≈ 0.009/tick ≈ 0.55 px/s,基本静止 */
  orbitHover: 0.004,
  jitterHover: 0.004,
  /** pointerOver 时 centripetal 也要降到接近 0 —— 否则会持续把节点拽向
   *  中心(0,0),即便切向 orbit/jitter 已经停了,centripetal 仍以全速
   *  21 px/s 向心,把节点全部拉到中心互相覆盖。配 orbitHover/jitterHover
   *  一起实现"hover → 图完全冻结"。 */
  centripetalHover: 0.004,
  /** d3-force charge 强度 —— -120 比 -100 更明显散开(配合低 velocityDecay
   *  让节点不会被向心过度收拢) */
  charge: -120,
  /** d3-force velocityDecay —— 平衡"运动"与"稳定命中"。
   *  0.3 比 d3 默认 0.4 衰减更慢,稳态轨道速度几乎翻倍;配合 hover 自适
   *  应(orbit/jitter/centripetal 都接近 0)让鼠标点击稳定 */
  velocityDecay: 0.3,
  /** collide force 半径系数 —— 默认 1.0 表示"节点之间最小间距 = 各自绘
   * 制半径之和"。1.0 是绘制半径完全贴边;0.5 允许互相挤压一半;2.5 强制
   * 留 2.5 倍空隙。范围 [0.5, 2.5] 由 ForceParamsPanel 的 RANGES 协调。 */
  collideRadius: 1.0,
  /** collide force 的 iterations(每 tick quadtree pass 次数) —— 默认 2
   * 比 d3 默认 1 更稳;密集场景(节点多 + refCount 差距大)收敛更好;调
   * 高会拖慢性能(每节点 × iterations × quadtree visit)。strength 锁死
   * 1.0 不暴露 — d3-force-collide 的 strength 默认就是 1,改它会让两个节
   * 点"按强度比"分配重叠位移,视觉上不可预测。 */
  collideIterations: 2
} as const

/** 闭包注入的 motionRef（共享层不感知细节，只读 strength） */
export interface MotionRef {
  orbit: number
  jitter: number
  centripetal: number
  /** collide force 半径系数 —— 见 DEFAULT_MOTION.collideRadius */
  collideRadius: number
}

export interface PhysicsController {
  motionRef: React.MutableRefObject<MotionRef>
  pointerOverRef: React.MutableRefObject<boolean>
  setPointerOver: (over: boolean) => void
  /** force 函数被调用的累计次数 —— panel 用这个做"force 在跑"心跳指示 */
  forceTickRef: React.MutableRefObject<number>
  /** 重设 collide force 的 collideRadius —— panel 用这个实时调滑条。
   * 用 setter 路线而不是重注册整个 force：保留 setCollideRadius 内部的
   * .radius() 闭包逻辑，只换系数；并 reheat 让 simulation 立刻应用新半径。 */
  setCollideRadius: (radius: number) => void
}

/**
 * 把物理参数 + pointerOver 状态打包到一个 hook 里。返回的 motionRef
 * 父组件可以直接读 / 写（commit 1 力参数滑杆会用到）。
 *
 * fgRef 用 unknown 类型 —— 内部用 d3Force('xxx', forceFn) 注入自定义 force，
 * 不依赖 N / L 泛型。
 */
export function useGraphPhysics(
  fgRef: React.RefObject<ForceGraphMethods<unknown, unknown> | undefined>,
  nodes: BaseGraphNode[],
  /** 当前是否在 tree 模式；tree 时所有 motion=0 */
  layoutModeRef: React.MutableRefObject<'force' | 'tree' | 'analyze'>,
  /** 可选：当前搜索是否激活 —— collide force 用它把搜索命中节点的碰撞半径放大 1.6×
   * （与 nodeVal / nodeCanvasObject 的搜索放大同步）。 */
  searchActiveRef?: React.MutableRefObject<boolean>
): PhysicsController {
  const motionRef = useRef<MotionRef>({
    orbit: DEFAULT_MOTION.orbit,
    jitter: DEFAULT_MOTION.jitter,
    centripetal: DEFAULT_MOTION.centripetal,
    collideRadius: DEFAULT_MOTION.collideRadius
  })
  const pointerOverRef = useRef(false)
  /* force 函数被调用累计次数 —— panel 用这个做"force 在跑"心跳指示。
   * 注意这个 ref 的写操作在 d3-force 闭包里跑（不在 React 渲染周期），
   * 仅作为只读计数器用。 */
  const forceTickRef = useRef(0)
  /* charge 仅在 fgRef 首次 ready 时初始化一次 —— useEffect 依赖里包含 nodes，
   * nodes 引用一变就重跑。如果 charge 也放在 effect 里重设，用户在 panel 调好
   * 的斥力值会在任何节点增删/边改动后被打回 DEFAULT_MOTION.charge(典型场景：
   * 用户先打开面板调到 -50 → 关掉面板 → 加一本书 → 斥力回到 -100)。
   * 用这个 ref 当"初始化一次"哨兵，让 charge 只设一次、之后完全交给 panel 控制。 */
  const chargeInitializedRef = useRef(false)
  /* collide force 同款"初始化一次"哨兵 —— 注册后每 tick 由 forceCollide 内部读
   * node.index 用，但 collideRadius/迭代次数等链式 setter 写在 force 实例上，
   * 后续 panel 调 collideRadius 时通过单独的 setter 走（见 ForceParamsPanel
   * handleCollideRadiusChange）。 */
  const collideInitializedRef = useRef(false)

  // 标记当前是否在 hover 状态 —— force 函数每 tick 读这个。
  // 注意：force 函数内部读 pointerOverRef.current + motionRef.current，
  // 用户在 panel 拖动时不会被任何代码"反向覆盖"。
  // 这样 panel 滑条拖到的值会立即生效，不与 hover 状态冲突。

  const setPointerOver = (over: boolean): void => {
    pointerOverRef.current = over
    /* 不再自动覆盖 motionRef —— 让用户通过 panel 自由控制；
     * hover 时降速靠 force 函数内部读 pointerOverRef 自动应用。 */
  }

  /* setCollideRadius —— panel 调 collideRadius 滑条时实时更新 collide force。
   * 用 .radius() setter 路线（同 d3-force-3d 链式 API），不重注册整个 force
   * （fg.d3Force('collide', newFn) 会让 simulation 重新跑初始化 nodes 路径，
   * motionRef.current.collideRadius 已经更新即生效，searchActiveRef?.current
   * 每 tick 由原闭包读，不需要重新绑定）。 reheat 让 simulation 重启 alpha
   * → 下次 tick 立刻按新半径算碰撞。
   *
   * 类型擦除同上 —— fg.d3Force('collide') 返回的 ForceFn<...> 静态类型不含 .radius
   * setter (那是 d3-force-3d 的扩展),用 unknown 双跳锁住。 */
  const setCollideRadius = (radius: number): void => {
    motionRef.current.collideRadius = radius
    const fg = fgRef.current
    if (!fg) return
    const collideRaw = fg.d3Force('collide') as unknown as
      | undefined
      | { radius: (r: (n: BaseGraphNode) => number) => unknown }
    if (!collideRaw) return
    try {
      collideRaw.radius((n: BaseGraphNode) => {
        const r = computeNodeRenderRadius(n) * radius
        return searchActiveRef?.current ? r * 1.6 : r
      })
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('setCollideRadius failed:', e)
    }
  }

  // 注册持续抖动 force：mount 后 fgRef 就绪时挂上。
  // d3Force('xxx') 在 d3 内模拟 tick 时被调用，每次给每个节点一个微小动量；
  // 不依赖 alphaTarget/alpha。
  /* force 函数每 tick 读 motionRef.current.{orbit,jitter,centripetal} +
   * pointerOverRef.current；hover 时 strength 自动降到 hover 值（不动 motionRef，
   * 不破坏用户 panel 拖到的值）。 collide force 函数每 tick 读 motionRef.current.
   * collideRadius + searchActiveRef?.current（搜索命中时半径放大 1.6）。 */
  const motionLive = motionRef
  const pointerOverLive = pointerOverRef
  const tickLive = forceTickRef
  const searchActiveLive = searchActiveRef ?? null
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      /* charge 仅首次初始化一次 —— 见 chargeInitializedRef 注释。 */
      if (!chargeInitializedRef.current) {
        const charge = fg.d3Force('charge')
        if (charge) {
          /* 1) 把 strength 设到默认值 —— 设到原 charge 实例上,
           *    strength accessor 转发后 Panel 仍能读到/写到正确值。 */
          if (typeof charge.strength === 'function') {
            charge.strength(DEFAULT_MOTION.charge)
          }
          /* 2) 包装 d3-force-charge,让 force 永远按 alpha=1 计算。
           *
           *  为什么:d3 默认 forceManyBody 是 alpha-scaled,alpha=0.001
           *  时 charge 几乎不推、alpha=1 时全速推 (-120 * 1)。
           *  d3ReheatSimulation() 内部调 simulation.restart(),把 alpha
           *  重置为 1。用户每次拖滑杆 / 重置都走 reheat,导致 charge
           *  在 alpha=1 短暂"爆发"推一次 —— 反复操作让节点被多次推而
           *  不会收敛(用户反馈「反复点设置图会不断向外散开」)。
           *
           *  包装后 charge 推力不依赖 alpha:reheat 只重启 simulation,
           *  不改变 charge 实际推力;balance radius 由 charge / centripetal
           *  / orbit / d3 center 四者决定,稳定。d3 Barnes-Hut 优化通过原
           *  charge 实例内部保留;strength accessor 转发到原 charge,Panel
           *  的 fg.d3Force('charge').strength() 接口保持兼容。
           *
           *  trade-off:balance radius 比"原版 + alpha 衰减到 0"更紧(charge
           *  不再随 alpha 衰减),节点布局更密;若实测太紧可调小
           *  DEFAULT_MOTION.charge 数值。 */
          const origCall = charge as unknown as (alpha: number) => void
          const origWithStrength = charge as unknown as {
            strength: (s: number | undefined) => unknown
          }
          const wrapped = function (_alpha: number): void {
            origCall(1.0)
          } as ((alpha: number) => void) & {
            strength?: (s: number | undefined) => unknown
          }
          wrapped.strength = function (s: number | undefined): unknown {
            if (typeof s === 'undefined') {
              const cur = origWithStrength.strength(undefined)
              /* d3-force-charge 默认 strength 是函数(常量包装);返回
               * undefined 让上游(Panel useState 初始化)走 DEFAULT_MOTION
               * 兜底,不暴露函数内部细节。 */
              return typeof cur === 'function' ? undefined : cur
            }
            origWithStrength.strength(s)
            return wrapped
          }
          fg.d3Force('charge', wrapped)
        }
        chargeInitializedRef.current = true
      }
      fg.d3Force('orbit', orbitForce(() => nodes, () => {
        tickLive.current++
        const over = pointerOverLive.current
        const base = motionLive.current.orbit
        return over ? Math.min(base, DEFAULT_MOTION.orbitHover) : base
      }))
      fg.d3Force('jitter', jitterForce(() => nodes, () => {
        tickLive.current++
        const over = pointerOverLive.current
        const base = motionLive.current.jitter
        return over ? Math.min(base, DEFAULT_MOTION.jitterHover) : base
      }))
      fg.d3Force('centripetal', centripetalForce(() => nodes, () => {
        tickLive.current++
        const over = pointerOverLive.current
        const base = motionLive.current.centripetal
        /* hover 时 centripetal 也降到接近 0 —— 否则会持续把节点拽进
         * 中心(0,0),即便切向 orbit/jitter 已经停了,节点仍会塌缩成
         * 一坨。Math.min(用户值, hover 默认值)让用户拖到 0 时彻底静止,
         * 不会被 hover 自适应"反向覆盖"成 0.004。 */
        return over ? Math.min(base, DEFAULT_MOTION.centripetalHover) : base
      }))
      /* collide force (2026-08) —— d3-force-3d 的 forceCollide。
       * 只在首次就绪时注册一次（collideInitializedRef 哨兵同 charge），panel 调
       * collideRadius 时走 setter（fg.d3Force('collide').radius(...) 重设 wrap
       * 函数，详见 ForceParamsPanel 的 handleCollideRadiusChange）。
       *
       * 类型擦除 'as unknown as ...' —— react-force-graph 的 d3Force 第二参
       * 是它自己内部的 NodeObject 类型 (=base + 几个 numeric optional fields),
       * 我们的 BaseGraphNode 含 required refCount,严格结构不兼容;运行时实际
       * 上 simulation 把 nodes 当 duck-type 索引 n.index / n.x / n.y / n.r 等,
       * 类型擦除不会导致运行时问题。 */
      if (!collideInitializedRef.current) {
        const collide = forceCollide<BaseGraphNode>()
          /* radius：每 tick 由 forceCollide 内部读 n.index 排 quadtree,
           * 我们的 radius 函数只算当前节点的"有效碰撞半径"（绘制半径
           * × collideRadius × 搜索放大系数）。 这与 paintNodes 用的同
           * 一份绘制半径保持一致 → 画完后看上去"刚好贴边"的两个节点,
           * collision force 也按这个贴边距离推,不会画完还在视觉上叠。 */
          .radius((n: BaseGraphNode) => {
            const r = computeNodeRenderRadius(n) * motionLive.current.collideRadius
            return searchActiveLive?.current ? r * 1.6 : r
          })
          .iterations(DEFAULT_MOTION.collideIterations)
          .strength(1)
        fg.d3Force('collide', collide as unknown as Parameters<typeof fg.d3Force>[1])
        collideInitializedRef.current = true
      }
      fg.d3ReheatSimulation()
      // eslint-disable-next-line no-console
      console.log('[useGraphPhysics] force 注册成功 nodes=', nodes.length,
        'motion=', JSON.stringify(motionLive.current),
        'pointerOver=', pointerOverLive.current)
    } catch (e) {
      console.warn('jitter force registration failed:', e)
    }
  }, [fgRef, nodes, motionLive, pointerOverLive, tickLive, searchActiveLive])

  /* DEBUG: 每秒打印 motion / pointerOver / tick 状态 —— 排查 "force 注册了但图不动"
   * 时用。生产构建会被 Vite tree-shake 掉（import.meta.env.DEV 静态 false），
   * 不会泄漏到 release。 */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const id = window.setInterval(() => {
      // eslint-disable-next-line no-console
      console.log('[useGraphPhysics] tick=',
        tickLive.current,
        'motion=', JSON.stringify(motionLive.current),
        'pointerOver=', pointerOverLive.current)
    }, 1000)
    return () => window.clearInterval(id)
  }, [motionLive, pointerOverLive, tickLive])

  return { motionRef, pointerOverRef, setPointerOver, forceTickRef, setCollideRadius }
}

/* =====================================================================
 *  三个 d3 force 工厂
 *  用闭包注入 nodes（d3-force 调 force 函数时 `this` 在 strict 模式下不可靠）。
 * ===================================================================== */

/** 轨道力：每 tick 给每个节点施加绕中心(0,0)的切向速度。 */
function orbitForce(
  getNodes: () => BaseGraphNode[],
  getStrength: () => number
): (alpha: number) => void {
  return function force(_alpha: number): void {
    const nodes = getNodes()
    if (!nodes || nodes.length === 0) return
    const strength = getStrength()
    if (strength <= 0) return
    for (const n of nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue
      const dx = n.x
      const dy = n.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) continue
      // 绕中心的切向单位向量（逆时针）
      n.vx = (n.vx ?? 0) + (-dy / d) * strength
      n.vy = (n.vy ?? 0) + (dx / d) * strength
    }
  }
}

/** 轻微 jitter：随机噪声让旋转更自然。强度必须小（默认 0.04），否则盖过轨道变抽搐。 */
function jitterForce(
  getNodes: () => BaseGraphNode[],
  getStrength: () => number
): (alpha: number) => void {
  return function force(_alpha: number): void {
    const nodes = getNodes()
    if (!nodes || nodes.length === 0) return
    const strength = getStrength()
    if (strength <= 0) return
    for (const n of nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue
      n.vx = (n.vx ?? 0) + (Math.random() - 0.5) * strength
      n.vy = (n.vy ?? 0) + (Math.random() - 0.5) * strength
    }
  }
}

/**
 * 向心力：每 tick 给每个节点施加一个指向 (0,0) 的径向速度增量。
 *
 * 与 orbitForce 互为反向——orbit 是切向（让节点绕中心转），centripetal 是径向
 * 向心（让节点被拉近中心）。两个力一起作用时，节点仍能保持绕转，但轨道半径
 * 会被向心力收小，整张图视觉上更紧凑、不"摊"成一片大饼。
 *
 * 强度是直接加到 vx/vy 上的常量，不是按距离衰减的（与 orbit 同风格）；
 * 实际效果接近"持续弱重力"，在 charge = -80 的斥力场里找到新平衡。
 * strength=0 时函数立即 return，d3 仍会每 tick 调一次（成本可忽略）。
 */
function centripetalForce(
  getNodes: () => BaseGraphNode[],
  getStrength: () => number
): (alpha: number) => void {
  return function force(_alpha: number): void {
    const nodes = getNodes()
    if (!nodes || nodes.length === 0) return
    const strength = getStrength()
    if (strength <= 0) return
    for (const n of nodes) {
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue
      const dx = n.x
      const dy = n.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) continue
      // 指向中心的单位向量（与 orbitForce 的切向分量垂直、方向相反）
      n.vx = (n.vx ?? 0) + (-dx / d) * strength
      n.vy = (n.vy ?? 0) + (-dy / d) * strength
    }
  }
}