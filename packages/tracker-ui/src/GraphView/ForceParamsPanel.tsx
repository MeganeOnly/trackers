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
//   - orbit:       [0, 0.2]     默认 0.05 —— 切向速度，让节点缓慢绕中心转
//   - jitter:      [0, 0.2]     默认 0.04 —— 随机噪声
//   - centripetal: [0, 0.1]     默认 0.02 —— 径向向心
//   - charge:      [-300, 0]    默认 -80  —— d3 电荷斥力
//
// 状态归 app 端（GraphView 通过 showForceParams / onForceParamsClose 暴露）。

import { useEffect, useState } from 'react'
import type { ForceGraphMethods } from 'react-force-graph-2d'
import { DEFAULT_MOTION, type MotionRef } from './useGraphPhysics'

interface ForceParamsPanelProps {
  fgRef: React.RefObject<ForceGraphMethods<unknown, unknown> | undefined>
  motionRef: React.MutableRefObject<MotionRef>
  onClose: () => void
}

const RANGES = {
  orbit: { min: 0, max: 0.2, step: 0.005, label: '轨道力', hint: '切向速度，让节点缓慢绕中心旋转' },
  jitter: { min: 0, max: 0.2, step: 0.005, label: '随机抖动', hint: '微随机噪声，让旋转自然不呆板' },
  centripetal: { min: 0, max: 0.1, step: 0.005, label: '向心力', hint: '径向向心，与 charge 平衡决定轨道半径' },
  charge: { min: -300, max: 0, step: 5, label: '电荷斥力', hint: '节点间互斥；负得越多越分散' }
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
  onClose
}: ForceParamsPanelProps): JSX.Element {
  /* fgRef 可能 mount 时还没 ready —— mount 后再读一次 charge 兜底 */
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
  // 强制 mount 时再同步一次 charge（fgRef.current 可能刚刚 ready）
  const [_, force] = useState(0)
  useEffect(() => {
    force((x) => x + 1)
  }, [])

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
    motionRef.current[key] = value
    /* d3 simulation 已冷却时（alpha < min）force 函数不会被调用，
     * 即使闭包读 motionRef 也无效 —— 必须 reheatSimulation 让 alpha 重启 */
    const fg = fgRef.current
    if (fg) {
      try {
        fg.d3ReheatSimulation()
      } catch (e) {
        /* 早期 mount / fgRef.current 还未完全 ready 时 reheat 偶尔抛错 */
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
        /* d3-force strength setter 接受数字或函数；数字直接赋值，
         * 但 d3 内部可能会包成 () => value —— setChargeVal 也用 Number */
        c.strength(value)
      }
      fg.d3ReheatSimulation()
    } catch (e) {
      console.warn('charge strength update failed:', e)
    }
  }

  const handleReset = (): void => {
    motionRef.current.orbit = DEFAULT_MOTION.orbit
    motionRef.current.jitter = DEFAULT_MOTION.jitter
    motionRef.current.centripetal = DEFAULT_MOTION.centripetal
    handleChargeChange(DEFAULT_MOTION.charge)
    // 滑杆受控：强制 re-render 让 UI 回到默认
    force((x) => x + 1)
  }

  return (
    <div className="force-params-panel" role="dialog" aria-label="力参数">
      <div className="force-params-header">
        <strong>力参数</strong>
        <button type="button" className="force-params-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="force-params-body">
        {MOTION_KEYS.map((key) => {
          const range = RANGES[key]
          const value = motionRef.current[key]
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
        <button type="button" className="force-params-reset" onClick={handleReset}>
          重置默认
        </button>
      </div>
    </div>
  )
}