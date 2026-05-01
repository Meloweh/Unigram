import { useRef, useState } from 'react'

export interface MpdDialProps {
  /** Available MPD model references (labels + ids) */
  options: { id: string; label: string }[]
  /** Index of the currently active option */
  activeIndex: number
  /** Called when the user selects a new MPD; direction = curtain sweep direction */
  onSelect: (index: number, direction: 'left' | 'right') => void
}

const PAD = 0.08 // 8% padding on each side of the dial track
const TICK_COUNT = 40

/**
 * Wide horizontal frequency-tuner dial for MPD dimension switching.
 * Drag left/right to rotate through options. Snaps on release.
 */
export function MpdDial({ options, activeIndex, onSelect }: MpdDialProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragDelta, setDragDelta] = useState(0) // fraction of track width
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ clientX: number } | null>(null)

  const count = options.length
  const usable = 1 - 2 * PAD
  const step = count > 1 ? usable / (count - 1) : 0
  const optFrac = (i: number) => PAD + (count > 1 ? i * step : usable / 2)

  const baseFrac = optFrac(activeIndex)
  const knobFrac = Math.max(PAD - 0.02, Math.min(1 - PAD + 0.02, baseFrac + dragDelta))

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragStartRef.current = { clientX: e.clientX }
    setIsDragging(true)
    setDragDelta(0)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!dragStartRef.current || !trackRef.current) return
    const w = trackRef.current.getBoundingClientRect().width
    setDragDelta((e.clientX - dragStartRef.current.clientX) / w)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!dragStartRef.current) return
    const savedDelta = dragDelta
    dragStartRef.current = null
    setIsDragging(false)
    setDragDelta(0)

    // Snap to nearest option
    const pos = Math.max(0, Math.min(1, baseFrac + savedDelta))
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < count; i++) {
      const dist = Math.abs(pos - optFrac(i))
      if (dist < bestDist) { bestDist = dist; bestIdx = i }
    }
    if (bestIdx !== activeIndex) {
      onSelect(bestIdx, bestIdx > activeIndex ? 'right' : 'left')
    }
  }

  const handleOptionClick = (i: number) => {
    if (i !== activeIndex) {
      onSelect(i, i > activeIndex ? 'right' : 'left')
    }
  }

  // Generate tick marks
  const ticks = []
  for (let i = 0; i <= TICK_COUNT; i++) {
    const frac = PAD + (i / TICK_COUNT) * usable
    const isOption = options.some((_, j) => Math.abs(frac - optFrac(j)) < 0.008)
    ticks.push({ frac, isOption })
  }

  return (
    <div
      className={`mpd-dial ${isDragging ? 'dragging' : ''}`}
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Option labels */}
      {options.map((opt, i) => (
        <span
          key={opt.id}
          className={`mpd-dial-label ${i === activeIndex ? 'active' : ''}`}
          style={{ left: `${optFrac(i) * 100}%` }}
          onClick={(e) => { e.stopPropagation(); handleOptionClick(i) }}
        >
          {opt.label}
        </span>
      ))}
      {/* Tick marks along the bottom */}
      <div className="mpd-dial-ticks">
        {ticks.map((t, i) => (
          <div
            key={i}
            className={`mpd-dial-tick ${t.isOption ? 'major' : ''}`}
            style={{ left: `${t.frac * 100}%` }}
          />
        ))}
      </div>
      {/* Sliding knob indicator */}
      <div
        className="mpd-dial-knob"
        style={{
          left: `${knobFrac * 100}%`,
          transition: isDragging ? 'none' : 'left 0.3s cubic-bezier(0.25,0.1,0.25,1)',
        }}
      />
    </div>
  )
}
