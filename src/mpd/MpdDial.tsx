/**
 * Wide horizontal "frequency-tuner" dial for switching between MPD
 * dimensions. Pure UI — no flushSync, no Pixi calls. Emits onSelect with
 * the new index and the sweep direction (left/right) so the caller can
 * trigger the curtain transition.
 */

import { useRef, useState } from 'react'

export interface MpdOption {
  id: string
  label: string
}

export interface MpdDialProps {
  options: MpdOption[]
  activeIndex: number
  onSelect: (index: number, direction: 'left' | 'right') => void
}

const PAD = 0.08
const TICK_COUNT = 40

export function MpdDial({ options, activeIndex, onSelect }: MpdDialProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef<number | null>(null)

  const count = options.length
  const usable = 1 - 2 * PAD
  const step = count > 1 ? usable / (count - 1) : 0
  const optFrac = (i: number) => (count > 1 ? PAD + i * step : PAD + usable / 2)

  const baseFrac = optFrac(activeIndex)
  const knobFrac = clamp(baseFrac + drag, PAD - 0.02, 1 - PAD + 0.02)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    startXRef.current = e.clientX
    setDragging(true)
    setDrag(0)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null || !trackRef.current) return
    e.stopPropagation()
    const w = trackRef.current.getBoundingClientRect().width
    setDrag((e.clientX - startXRef.current) / w)
  }
  const finalize = (savedDrag: number) => {
    const pos = clamp(baseFrac + savedDrag, 0, 1)
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < count; i++) {
      const d = Math.abs(pos - optFrac(i))
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    if (bestIdx !== activeIndex) {
      onSelect(bestIdx, bestIdx > activeIndex ? 'right' : 'left')
    }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null) return
    e.stopPropagation()
    const saved = drag
    startXRef.current = null
    setDragging(false)
    setDrag(0)
    finalize(saved)
  }

  const ticks: { frac: number; major: boolean }[] = []
  for (let i = 0; i <= TICK_COUNT; i++) {
    const frac = PAD + (i / TICK_COUNT) * usable
    const major = options.some((_, j) => Math.abs(frac - optFrac(j)) < 0.008)
    ticks.push({ frac, major })
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'relative',
        width: 'min(560px, 80vw)',
        height: 64,
        background: 'rgba(15, 22, 36, 0.92)',
        border: '1px solid #2a3550',
        borderRadius: 10,
        boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
        userSelect: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        overflow: 'hidden',
      }}
    >
      {options.map((opt, i) => (
        <span
          key={opt.id}
          onClick={(e) => {
            e.stopPropagation()
            if (i !== activeIndex) onSelect(i, i > activeIndex ? 'right' : 'left')
          }}
          style={{
            position: 'absolute',
            left: `${optFrac(i) * 100}%`,
            transform: 'translateX(-50%)',
            top: 8,
            font: '11px system-ui, sans-serif',
            color: i === activeIndex ? '#cfe4ff' : '#7689ad',
            fontWeight: i === activeIndex ? 600 : 400,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {opt.label}
        </span>
      ))}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 12,
          height: 16,
          pointerEvents: 'none',
        }}
      >
        {ticks.map((t, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${t.frac * 100}%`,
              bottom: 0,
              width: 1,
              height: t.major ? 14 : 8,
              background: t.major ? '#5d7aab' : '#3a4868',
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: `${knobFrac * 100}%`,
          transform: 'translateX(-50%)',
          bottom: 8,
          width: 4,
          height: 24,
          background: '#4aa3ff',
          borderRadius: 2,
          boxShadow: '0 0 8px rgba(74, 163, 255, 0.7)',
          transition: dragging ? 'none' : 'left 0.25s cubic-bezier(0.25,0.1,0.25,1)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}
