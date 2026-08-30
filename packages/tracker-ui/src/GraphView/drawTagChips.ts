// packages/tracker-ui/src/GraphView/drawTagChips.ts
//
// 把一组 tag 字符串画成一行矩形 chip —— 给节点标题下面加一行"标签条"。
// book-tracker 在 GraphView 节点下方画 tags chip 用此函数；其它 app 不传 tags 时不调。
//
// 设计要点（从原 book-tracker GraphView 沿用，注释保留）：
//   - 中心对齐（cx 是整行 chip 的几何中心），与标题节点对齐
//   - chip 数 > MAX_VISIBLE 时只画前 MAX_VISIBLE 个 + "+N"，防 tag 多时画不下
//   - chip 间 gap 固定，与节点半径无关（zoom-out 时整行缩放）
//   - 所有 ctx.fillStyle / strokeStyle 改完必须还原或用局部变量，
//     否则 react-force-graph 的 nodeCanvasObject 在每个节点高频调用时会污染下个节点

export function drawTagChips(
  ctx: CanvasRenderingContext2D,
  tags: string[],
  cx: number,
  y: number,
  scale: number,
  opts: {
    bg?: string
    border?: string
    fg?: string
    chipH?: number
    padX?: number
    gap?: number
    fontSize?: number
    maxVisible?: number
  } = {}
): void {
  if (tags.length === 0) return
  const bg = opts.bg ?? '#eaf1ec'
  const border = opts.border ?? '#4a7c59'
  const fg = opts.fg ?? '#2d5a3a'
  const chipH = opts.chipH ?? 13 / scale
  const padX = opts.padX ?? 5 / scale
  const gap = opts.gap ?? 3 / scale
  const fontSize = opts.fontSize ?? 9 / scale
  const MAX_VISIBLE = opts.maxVisible ?? 3

  const visible = tags.slice(0, MAX_VISIBLE)
  const overflow = tags.length - visible.length
  const labels = overflow > 0 ? [...visible, `+${overflow}`] : visible

  ctx.font = `${fontSize}px -apple-system, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // 先量宽度,再算起点 x 让整行居中
  const widths: number[] = labels.map((t) => ctx.measureText(t).width + padX * 2)
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)
  let x = cx - totalW / 2

  ctx.fillStyle = bg
  ctx.strokeStyle = border
  ctx.lineWidth = 0.6 / scale
  for (let i = 0; i < labels.length; i++) {
    const w = widths[i]
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, chipH, 3 / scale)
    } else {
      ctx.rect(x, y, w, chipH)
    }
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = fg
    ctx.fillText(labels[i], x + padX, y + chipH / 2)
    ctx.fillStyle = bg // 还原,下一个 chip 用回 bg
    x += w + gap
  }
}