// packages/tracker-ui/src/GraphView/useResize.ts
//
// ResizeObserver 测量宽高 → 同步设 dims 触发 ForceGraph2D 重渲染。
// 同步测一次避免初次 800x600 flash。
//
// 从两 app 原 GraphView.tsx 抽出的 useLayoutEffect 直接搬过来,
// 行为不变;只是移到共享层。

import { useLayoutEffect, useState } from 'react'

export interface Dims {
  w: number
  h: number
}

const FALLBACK: Dims = { w: 800, h: 600 }

export function useResize(wrapRef: React.RefObject<HTMLDivElement>): Dims {
  const [dims, setDims] = useState<Dims>(FALLBACK)
  useLayoutEffect(() => {
    if (!wrapRef.current) return
    const measure = (): void => {
      const rect = wrapRef.current!.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setDims({ w: rect.width, h: rect.height })
      }
    }
    measure() /* 同步测一次,避免初次 800x600 flash */
    const ro = new ResizeObserver(measure)
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [wrapRef])
  return dims
}