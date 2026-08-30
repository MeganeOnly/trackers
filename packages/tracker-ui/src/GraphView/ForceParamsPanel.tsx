// packages/tracker-ui/src/GraphView/ForceParamsPanel.tsx
//
// 力参数浮窗 —— 实时调节 d3-force 的 orbit / jitter / centripetal / charge。
//
// 行为：
//   - 滑杆改 motionRef.current.{orbit, jitter, centripetal} 立即生效
//     （force 函数每 tick 闭包读 motionRef，无需重新注册 force）
//   - 滑杆改 charge 通过 fgRef.current.d3Force('charge').strength() 设置，
//     然后 reheatSimulation 让 d3 应用新斥力
//   - 重置按钮回到 DEFAULT_MOTION 常量
//   - 浮窗右上 × / Esc 关闭（onClose 回调）
//
// 数值范围（与 DEFAULT_MOTION 协调）：
//   - orbit:         [0, 0.6]     默认 0.35 —— 切向速度，让节点绕中心旋转
//   - jitter:        [0, 0.4]     默认 0.25 —— 随机噪声(有机感)
//   - centripetal:   [0, 0.25]    默认 0.15 —— 径向向心(收半径)
//   - charge:        [-300, 0]    默认 -120 —— d3 电荷斥力
//   - collideRadius: [0.5, 2.5]   默认 1.0 —— 实体碰撞半径系数(2026-08 加)
//                                1.0=与绘制半径贴边、0.5=允许挤压一半、2.5=强制 2.5×间距
//                                由 useGraphPhysics 暴露的 setCollideRadius 走链式 setter
//
//   范围与 DEFAULT_MOTION 协调:max 必须 ≥ 默认值,且在用户拉到 max 时仍应
//   有"明显但不失控"的视觉(orbit=0.6 约 84 px/s,11 秒/圈 @150px 半径)。
//
// 状态归 app 端（GraphView 通过 showForceParams / onForceParamsClose 暴露）。

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import { DEFAULT_MOTION, type MotionRef } from './useGraphPhysics'

interface ForceParamsPanelProps {
  fgRef: React.RefObject<ForceGraphMethods<unknown, unknown> | undefined>
  motionRef: React.MutableRefObject<MotionRef>
  /** force 函数被调累计次数 —— 心跳指示器 */
  forceTickRef?: React.MutableRefObject<number>
  /** 当前 layoutMode(force / tree / analyze) —— 切换时 index.tsx 会修改 motionRef
   *  (切到 tree/analyze 备份后置 0、切回 force 恢复或重置为 DEFAULT_MOTION),
   *  panel 监听此变化重新从 motionRef 同步本地 motionVals,避免滑杆值与实际
   *  生效值脱节。 */
  layoutMode?: 'force' | 'tree' | 'analyze'
  /** 重设 collide force 半径系数 —— useGraphPhysics 暴露的 setter(2026-08 加)。
   * 滑条 handle 拖动时调它,走过链式 .radius() 路线,不重注册整个 collide。 */
  setCollideRadius?: (radius: number) => void
  onClose: () => void
}

const RANGES = {
  orbit: { min: 0, max: 0.6, step: 0.01, label: '轨道力', hint: '切向速度，让节点绕中心旋转' },
  jitter: { min: 0, max: 0.4, step: 0.01, label: '随机抖动', hint: '微随机噪声，让旋转自然不呆板' },
  centripetal: { min: 0, max: 0.25, step: 0.005, label: '向心力', hint: '径向向心，与 charge 平衡决定轨道半径' },
  charge: { min: -300, max: 0, step: 5, label: '电荷斥力', hint: '节点间互斥；负得越多越分散' },
  collideRadius: {
    min: 0.5,
    max: 2.5,
    step: 0.05,
    label: '碰撞半径',
    hint: '节点间最小间距倍数；1.0 = 与绘制半径贴边'
  }
} as const

type ParamKey = keyof typeof RANGES

const MOTION_KEYS: readonly ('orbit' | 'jitter' | 'centripetal')[] = [
  'orbit',
  'jitter',
  'centripetal'
]

export function ForceParamsPanel({
  fgRef,
  motionRef,
  forceTickRef,
  layoutMode,
  setCollideRadius,
  onClose
}: ForceParamsPanelProps): JSX.Element {
  /* motion 三参用本地 useState 受控：避免 ref + React 受控 input 的同步陷阱
   * （React 重渲染时若 ref 没同步到当前 value，input 会被"贴回"导致拖不动） */
  const [motionVals, setMotionVals] = useState(() => ({
    orbit: motionRef.current.orbit,
    jitter: motionRef.current.jitter,
    centripetal: motionRef.current.centripetal
  }))

  /* layoutMode 切换时(index.tsx 会改 motionRef)重新同步本地 motionVals,
   * 避免滑杆值与实际生效值脱节。注意这里 useEffect 依赖 layoutMode 而非
   * motionRef —— 后者是 ref,引用稳定不变,无法触发 useEffect。
   * 仅在 layoutMode 实际变化时才同步;首次 mount 时 useState 已从 motionRef
   * 初始化,不需要 useEffect 再读一次。 */
  useEffect(() => {
    setMotionVals({
      orbit: motionRef.current.orbit,
      jitter: motionRef.current.jitter,
      centripetal: motionRef.current.centripetal
    })
    /* 仅当 layoutMode 实际传过来时同步 —— 未传(undefined)= 单测/无 context 调用 */
  }, [layoutMode])

  /* force 心跳 —— force 函数每 tick 会自增 forceTickRef，
   * panel 用 setInterval 周期性读这个值显示给用户：
   * 绿色 dot 闪烁 = force 在跑；静止 = simulation 已冷却（无 effect） */
  const [heartbeat, setHeartbeat] = useState(0)
  useEffect(() => {
    if (!forceTickRef) return
    const id = setInterval(() => setHeartbeat(forceTickRef.current), 200)
    return () => clearInterval(id)
  }, [forceTickRef])
  /* mount 时同步 fgRef → charge 实际值（fgRef 可能 mount 时还没 ready） */
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const c = fg.d3Force('charge')
    if (c && typeof c.strength === 'function') {
      const s = c.strength()
      if (typeof s !== 'function') setChargeVal(Number(s))
    }
  }, [fgRef])
  // charge 从 fgRef 读初始值（不能直接用 DEFAULT_MOTION.charge，
  // 因为用户可能调过；其它 motion 字段从 motionRef 读）
  // 注意 d3-force 的 charge 默认 strength 是函数（(d) => -d*d），
  // c.strength() 无参返回的可能是函数而不是数字 —— 用 Number() 兜底
  const [chargeVal, setChargeVal] = useState<number>(() => {
    const fg = fgRef.current
    if (!fg) return DEFAULT_MOTION.charge
    const c = fg.d3Force('charge')
    if (c && typeof c.strength === 'function') {
      const s = c.strength()
      return typeof s === 'function' ? DEFAULT_MOTION.charge : Number(s)
    }
    return DEFAULT_MOTION.charge
  })
  // （之前的 force/_ 已删除 —— useState 受控后不需要强制 re-render）

  /* collideRadius 本地 state（2026-08 加）—— 受控 input 走 useState,
   * 同 motionVals 处理。每次拖动 handle:
   * 1) 写本地 state (受控 input)
   * 2) 调 useGraphPhysics 暴露的 setCollideRadius (走链式 .radius() setter,
   *    不重注册整个 collide force) → d3 即时应用新半径。 */
  const [collideRadiusVal, setCollideRadiusVal] = useState<number>(() => motionRef.current.collideRadius)
  /* layoutMode 切换时(index.tsx 会改 motionRef)重新同步本地 collideRadiusVal,
   * 否则切回 force 时 motionRef 已恢复为旧值,滑条却还停在切走前位置,会脱节。 */
  useEffect(() => {
    setCollideRadiusVal(motionRef.current.collideRadius)
  }, [layoutMode])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleMotionChange = (
    key: 'orbit' | 'jitter' | 'centripetal',
    value: number
  ): void => {
    /* 1) 写本地 state（让 input 真正受控） */
    setMotionVals((prev) => ({ ...prev, [key]: value }))
    /* 2) 写共享 ref（force 函数闭包读这个） */
    motionRef.current[key] = value
    /* 3) 重启 simulation（alpha 已冷却时 force 不被调用） */
    const fg = fgRef.current
    if (fg) {
      try {
        fg.d3ReheatSimulation()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('reheat on motion change failed:', e)
      }
    }
  }

  const handleChargeChange = (value: number): void => {
    setChargeVal(value)
    const fg = fgRef.current
    if (!fg) return
    try {
      const c = fg.d3Force('charge')
      if (c && typeof c.strength === 'function') {
        /* d3-force strength setter 接受数字或函数；数字直接赋值,
         * 但 d3 内部可能会包成 () => value —— setChargeVal 也用 Number */
        c.strength(value)
      }
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('charge strength update failed:', e)
    }
  }

  /* handleCollideRadiusChange (2026-08) —— 拖碰撞半径滑条时实时更新 collide
   * force。 走 useGraphPhysics 暴露的 setCollideRadius 而不是直接 fg.d3Force,
   * 后者需要 panel 自己重新实现 radius 闭包(闭包要拿到 searchActiveRef)—— 把
   * 闭包放在 hook 内部,setter 只传一个 number,与 charge 的"取强度值 → 写 d3
   * setter"模式一致。 */
  const handleCollideRadiusChange = (value: number): void => {
    setCollideRadiusVal(value)
    if (setCollideRadius) setCollideRadius(value)
  }

  const handleReset = (): void => {
    setMotionVals({
      orbit: DEFAULT_MOTION.orbit,
      jitter: DEFAULT_MOTION.jitter,
      centripetal: DEFAULT_MOTION.centripetal
    })
    motionRef.current.orbit = DEFAULT_MOTION.orbit
    motionRef.current.jitter = DEFAULT_MOTION.jitter
    motionRef.current.centripetal = DEFAULT_MOTION.centripetal
    handleChargeChange(DEFAULT_MOTION.charge)
    handleCollideRadiusChange(DEFAULT_MOTION.collideRadius)
  }

  return createPortal(
    <div className="force-params-panel" role="dialog" aria-label="力参数">
      <div className="force-params-header">
        <strong>力参数</strong>
        <button type="button" className="force-params-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="force-params-body">
        {forceTickRef && (
          <div
            className="force-heartbeat"
            title="绿色闪烁 = force 函数正在被 d3 调用；静止 = simulation 已冷却"
            data-active={heartbeat > 0 ? 'yes' : 'no'}
          >
            <span className="force-heartbeat-dot" />
            <span className="force-heartbeat-text">
              force tick #{heartbeat}
            </span>
          </div>
        )}
        {MOTION_KEYS.map((key) => {
          const range = RANGES[key]
          const value = motionVals[key]
          return (
            <label key={key} className="force-param-row">
              <span className="force-param-label" data-tip={range.hint}>
                {range.label}
                <span className="force-param-value">{value.toFixed(3)}</span>
              </span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={value}
                onChange={(e) => handleMotionChange(key, Number(e.target.value))}
              />
            </label>
          )
        })}
        <label className="force-param-row">
          <span className="force-param-label" data-tip={RANGES.charge.hint}>
            {RANGES.charge.label}
            <span className="force-param-value">{chargeVal.toFixed(0)}</span>
          </span>
          <input
            type="range"
            min={RANGES.charge.min}
            max={RANGES.charge.max}
            step={RANGES.charge.step}
            value={chargeVal}
            onChange={(e) => handleChargeChange(Number(e.target.value))}
          />
        </label>
        {/* 碰撞半径系数（2026-08 加）—— 走 useGraphPhysics.setCollideRadius 链式
            setter 路线,见 handleCollideRadiusChange。setCollideRadius 未传时滑条
            仍渲染但不影响 d3,单测 / Mock 场景用。 */}
        <label className="force-param-row">
          <span className="force-param-label" data-tip={RANGES.collideRadius.hint}>
            {RANGES.collideRadius.label}
            <span className="force-param-value">{collideRadiusVal.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={RANGES.collideRadius.min}
            max={RANGES.collideRadius.max}
            step={RANGES.collideRadius.step}
            value={collideRadiusVal}
            onChange={(e) => handleCollideRadiusChange(Number(e.target.value))}
          />
        </label>
        <button type="button" className="force-params-reset" onClick={handleReset}>
          重置默认
        </button>
      </div>
    </div>,
    document.body
  )
}