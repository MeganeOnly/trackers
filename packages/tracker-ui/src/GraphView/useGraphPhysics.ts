// packages/tracker-ui/src/GraphView/useGraphPhysics.ts
//
// 力导向物理注册：orbit / jitter / centripetal 三个自定义 d3 force，
// 加上 charge 强度调节 + pointerOver 自适应。
//
// 来自两 app 原 GraphView.tsx 的物理部分（行为完全一致，注释收敛）。
// 关键设计：
//
// 1) orbit 是切向速度（绕中心(0,0)旋转），让节点一直缓慢运动——
//    d3-force 的 charge / link / center 是保守力，alpha 多高都不能让平衡态再动；
//    给每个节点持续加切向速度，整张图变成缓慢旋转的云，永远有运动但不抽搐。
// 2) centripetal 是径向向心（拉向中心），让轨道半径被收小，视觉更紧凑。
// 3) jitter 是小幅度随机噪声，让旋转不呆板；强度必须小。
// 4) 鼠标在图上时把 orbit/jitter 降到接近 0——图"停住"才能稳定命中：
//    react-force-graph 的 hover/点击命中靠一张 800ms 才刷新一次的 shadow canvas,
//    节点一直高速运动时点击会落空（点到可见位置、命中却在别处），甚至被当成拖拽。
//
// 强度用闭包注入（motionRef 改值即可，无需重新注册 force）。

import { useEffect, useRef } from 'react'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import type { BaseGraphNode, BaseGraphLink } from './types'

/** 默认物理参数 —— 与原 GraphView 保持一致 */
export const DEFAULT_MOTION = {
  orbit: 0.05,
  jitter: 0.04,
  centripetal: 0.02,
  /** pointerOver 时降到接近 0 */
  orbitHover: 0.004,
  jitterHover: 0.004,
  /** d3-force charge 强度 —— 默认 -30 对小图太弱，节点会挤成一团；-80 散开可读 */
  charge: -80,
  /** d3-force velocityDecay —— 平衡"运动"与"稳定命中" */
  velocityDecay: 0.4
} as const

/** 闭包注入的 motionRef（共享层不感知细节，只读 strength） */
export interface MotionRef {
  orbit: number
  jitter: number
  centripetal: number
}

export interface PhysicsController {
  motionRef: React.MutableRefObject<MotionRef>
  pointerOverRef: React.MutableRefObject<boolean>
  setPointerOver: (over: boolean) => void
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
  layoutModeRef: React.MutableRefObject<'force' | 'tree' | 'analyze'>
): PhysicsController {
  const motionRef = useRef<MotionRef>({
    orbit: DEFAULT_MOTION.orbit,
    jitter: DEFAULT_MOTION.jitter,
    centripetal: DEFAULT_MOTION.centripetal
  })
  const pointerOverRef = useRef(false)

  // 标记当前是否在 hover 状态 —— force 函数每 tick 读这个。
  // 注意：force 函数内部读 pointerOverRef.current + motionRef.current，
  // 用户在 panel 拖动时不会被任何代码"反向覆盖"。
  // 这样 panel 滑条拖到的值会立即生效，不与 hover 状态冲突。

  const setPointerOver = (over: boolean): void => {
    pointerOverRef.current = over
    /* 不再自动覆盖 motionRef —— 让用户通过 panel 自由控制；
     * hover 时降速靠 force 函数内部读 pointerOverRef 自动应用。 */
  }

  // 注册持续抖动 force：mount 后 fgRef 就绪时挂上。
  // d3Force('xxx') 在 d3 内模拟 tick 时被调用，每次给每个节点一个微小动量；
  // 不依赖 alphaTarget/alpha。
  /* force 函数每 tick 读 motionRef.current.{orbit,jitter,centripetal} +
   * pointerOverRef.current；hover 时 strength 自动降到 hover 值（不动 motionRef，
   * 不破坏用户 panel 拖到的值） */
  const motionLive = motionRef
  const pointerOverLive = pointerOverRef
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    try {
      const charge = fg.d3Force('charge')
      if (charge && typeof charge.strength === 'function') charge.strength(DEFAULT_MOTION.charge)
      fg.d3Force('orbit', orbitForce(() => nodes, () => {
        const over = pointerOverLive.current
        const base = motionLive.current.orbit
        return over ? Math.min(base, DEFAULT_MOTION.orbitHover) : base
      }))
      fg.d3Force('jitter', jitterForce(() => nodes, () => {
        const over = pointerOverLive.current
        const base = motionLive.current.jitter
        return over ? Math.min(base, DEFAULT_MOTION.jitterHover) : base
      }))
      fg.d3Force('centripetal', centripetalForce(() => nodes, () => motionLive.current.centripetal))
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('jitter force registration failed:', e)
    }
  }, [fgRef, nodes, motionLive, pointerOverLive])

  return { motionRef, pointerOverRef, setPointerOver }
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