// packages/tracker-ui/src/GraphView/ColorPicker.tsx
//
// 节点色维度切换 chips —— 让用户切"按 status / tag / category / unlock 着色"。
//
// 视觉：紧凑的 segmented chips，active 项 accent 背景 + 白字。
//
// 共享层只渲染 chip UI + onChange 回调；具体的 color 规则由 app 端的
// getNodeColor 根据 currentBy 决定（共享层不感知各维度的颜色映射）。

import type { ColorBy } from './colors'

export interface ColorPickerOption {
  value: ColorBy
  label: string
  /** tooltip 一句话说明 */
  hint?: string
}

interface ColorPickerProps {
  value: ColorBy
  onChange: (by: ColorBy) => void
  options: ColorPickerOption[]
}

export function ColorPicker({ value, onChange, options }: ColorPickerProps): JSX.Element {
  return (
    <div className="graph-color-picker" role="group" aria-label="节点色维度">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={'graph-color-chip' + (value === o.value ? ' active' : '')}
          onClick={() => onChange(o.value)}
          title={o.hint ?? o.label}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}