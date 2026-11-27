import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

/** 'width': as wide as the box allows (taller cards scroll); 'both': the
 *  whole card fits the box; a number: that zoom (1 = the game's size). */
export type CardZoom = 'width' | 'both' | number

/**
 * Shows a card scaled to its box. The card keeps its real size inside (so
 * PNG export and layout are unaffected) and is scaled as a whole; the box
 * reserves the scaled size so scrolling works at any zoom.
 */
export function ScaledCard({
  zoom,
  max = 1.6,
  className,
  children,
}: {
  zoom: CardZoom
  /** largest scale a fitting zoom may reach */
  max?: number
  className?: string
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0, bw: 0, bh: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const b = box.current
      const i = inner.current
      if (!b || !i) return
      const cs = getComputedStyle(b)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const next = { w: i.offsetWidth, h: i.offsetHeight, bw: b.clientWidth - padX, bh: b.clientHeight - padY }
      setSize((s) => (s.w === next.w && s.h === next.h && s.bw === next.bw && s.bh === next.bh ? s : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [])

  let scale = 1
  if (size.w > 0) {
    if (typeof zoom === 'number') scale = zoom
    else {
      const byWidth = size.bw / size.w
      scale = zoom === 'both' && size.h > 0 ? Math.min(byWidth, size.bh / size.h) : byWidth
      scale = Math.max(0.3, Math.min(max, scale))
    }
  }

  return (
    <div ref={box} className={`scaled-card ${className ?? ''}`}>
      <div
        className="scaled-card-sizer"
        style={{ width: size.w ? size.w * scale : undefined, height: size.h ? size.h * scale : undefined }}
      >
        <div
          ref={inner}
          className="scaled-card-inner"
          style={{ transform: scale === 1 ? undefined : `scale(${scale})`, visibility: size.w ? undefined : 'hidden' }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
