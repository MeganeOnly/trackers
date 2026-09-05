/**
 * InlineField —— 详情页字段「默认预览 + 点击白框编辑」二态组件
 *
 * 设计要点（与 AGENTS.md §十.43 + §十.44 一脉相承）：
 * - 受控组件 —— value / onChange 由父组件持有，父组件沿用底部"保存"统一写盘
 *   本地 draft 语义不变，只是显示模式从「常驻 input」换成「preview ↔ edit」
 * - 父组件统一管理 editingField: string | null,一次只编辑一个字段
 *   （避免同时打开 5+ 白框的混乱 UX）
 * - 编辑态自动 focus + select all;Esc 退出编辑;blur 退出编辑
 * - 空值显示 muted 占位符（"点击设置 XXX"）—— 跟笔记预览态的"空白"语义对齐
 *
 * 支持三种编辑控件：
 * - 'text' → <input type="text">
 * - 'number' → <input type="number">（min/max 可选）
 * - 'select' → <select> + options
 *
 * normalize 钩子：number 类型可以包一层（如 read_count 强制 ≥ 1）
 */
import { useEffect, useRef } from 'react'

export interface InlineFieldOption {
  value: string
  label: string
}

export interface InlineFieldProps {
  /** 字段标题（如"作者"），始终可见 */
  label: string
  /** 预览态展示文本（由父组件根据 kind / 当前值格式化） */
  display: string
  /** 编辑态当前值（受控） */
  value: string
  /** 受控 value setter —— 编辑控件 onChange 直接转发 */
  onChange: (v: string) => void
  /** 当前是否处于编辑态 */
  editing: boolean
  /** 进入编辑（父组件 setEditingField(thisId)） */
  onActivate: () => void
  /** 退出编辑（父组件 setEditingField(null)） */
  onDeactivate: () => void
  /** 编辑控件类型 */
  kind: 'text' | 'number' | 'select'
  /** select 候选项 */
  options?: InlineFieldOption[]
  /** 空值占位符文本（如"点击设置 年份"） */
  emptyPlaceholder: string
  /** number 类型边界 */
  min?: number
  max?: number
  /** 编辑时 onChange 钩子（用于 read_count 强制 ≥ 1 之类的归一化） */
  normalize?: (raw: string) => string
  /** 用于父组件 editingField 字段标识（也用于测试定位） */
  fieldId: string
}

export function InlineField({
  label,
  display,
  value,
  onChange,
  editing,
  onActivate,
  onDeactivate,
  kind,
  options,
  emptyPlaceholder,
  min,
  max,
  normalize,
  fieldId
}: InlineFieldProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  // 进入编辑态自动 focus + 全选,方便覆盖式重输
  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    // setTimeout 让 React commit 完 DOM 后再聚焦,否则 autofocus 时序不稳
    const t = window.setTimeout(() => {
      el.focus()
      if (el instanceof HTMLInputElement) {
        el.select()
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [editing])

  const isEmpty = display.trim() === ''
  // 父组件传过来的 display 已经按 kind 格式化（如 status 显示"在读"）,
  // isEmpty 判断只用于"是否有值"的视觉占位提示
  const showEmptyPlaceholder = isEmpty

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onDeactivate()
      // blur 避免再次触发 onBlur 关闭（其实 idempotent,主要是清残留 focus）
      ;(e.currentTarget as HTMLInputElement | HTMLSelectElement).blur()
    }
    // 回车对单行 input/select 无副作用(textarea 才会换行);
    // 这里故意不响应 Enter,保持简单
  }

  return (
    <div className={`inline-field${editing ? ' is-editing' : ''}${showEmptyPlaceholder && !editing ? ' is-empty' : ''}`}>
      <span className="inline-field-label">{label}</span>
      {editing ? (
        kind === 'select' ? (
          <select
            ref={(el) => {
              inputRef.current = el
            }}
            className="inline-field-control"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onDeactivate}
            onKeyDown={handleKeyDown}
            data-field-id={fieldId}
          >
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={(el) => {
              inputRef.current = el
            }}
            className="inline-field-control"
            type={kind === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => {
              const raw = e.target.value
              onChange(normalize ? normalize(raw) : raw)
            }}
            onBlur={onDeactivate}
            onKeyDown={handleKeyDown}
            min={min}
            max={max}
            data-field-id={fieldId}
          />
        )
      ) : (
        <button
          type="button"
          className="inline-field-preview"
          onClick={onActivate}
          title="点击编辑"
          data-field-id={fieldId}
        >
          {showEmptyPlaceholder ? <span className="inline-field-empty">{emptyPlaceholder}</span> : display}
        </button>
      )}
    </div>
  )
}
