// packages/tracker-ui/src/StampChip.tsx
//
// 签名元素:印章 chip —— "已完成 / 已达成" 状态显示为实色方角 chip + 白字 + 微旋转 -2°。
// 跨 preset 显示,样式随 preset 变(classic 圆角无旋转,library/codex 方角 -2° 旋转)。
//
// 用法:
//   <StampChip label="已读" />                  —— 默认 done 状态(用 --accent)
//   <StampChip label="已达成" state="done" />    —— 显式指定 state

interface StampChipProps {
  /** chip 文字,如"已读" / "已达成" / "Finished" */
  label: string
  /** 状态,影响颜色(默认 done = --accent) */
  state?: 'done' | 'finished' | 'in_progress' | 'reading' | 'custom'
}

export function StampChip({ label, state = 'done' }: StampChipProps): JSX.Element {
  return (
    <span className="tracker-stamp" data-state={state}>
      {label}
    </span>
  )
}
