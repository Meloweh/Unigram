import { useEffect, useRef, useState } from 'react'
import type { StudyEvidence } from './sampleModels'
import { useHybridZoomStore, type UnzipLevel } from './useHybridZoomStore'

interface UnzipPopupProps {
  connectionKey: string
  level: UnzipLevel
  evidence: StudyEvidence[]
  anchorX: number
  anchorY: number
  animProgress: number
  /** Screen-space angle of the connection line (radians) */
  connectionAngle: number
  onSizeChange?: (w: number, h: number) => void
}

/**
 * Build a clip-path polygon that reveals the popup perpendicular to the connection line.
 * At progress=0 the polygon collapses into a thin slit along the connection direction (invisible).
 * At progress=1 it opens fully perpendicular (the "scroll unfurling from the stick").
 */
function buildRevealClip(w: number, h: number, angle: number, progress: number): string {
  const cx = w / 2
  const cy = h / 2
  // Half-diagonal + padding: ensures the along-axis always covers the entire popup
  const diag = Math.sqrt(w * w + h * h) / 2 + 24

  // Along the connection direction (the "stick")
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)

  // Perpendicular to the connection (the unfurl direction)
  const px = -sinA
  const py = cosA

  const halfAlong = diag
  const halfPerp = diag * progress

  // Four corners of the rotated reveal rectangle
  const points = [
    [cx + cosA * halfAlong + px * halfPerp, cy + sinA * halfAlong + py * halfPerp],
    [cx + cosA * halfAlong - px * halfPerp, cy + sinA * halfAlong - py * halfPerp],
    [cx - cosA * halfAlong - px * halfPerp, cy - sinA * halfAlong - py * halfPerp],
    [cx - cosA * halfAlong + px * halfPerp, cy - sinA * halfAlong + py * halfPerp],
  ]

  return `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(', ')})`
}

export function UnzipPopup({
  connectionKey, level, evidence, anchorX, anchorY, animProgress, connectionAngle, onSizeChange,
}: UnzipPopupProps) {
  const { closeUnzip, unzipDeeper, unzipShallower } = useHybridZoomStore()
  const popupRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 200 })

  // Measure popup border-box for accurate clip-path
  useEffect(() => {
    const el = popupRef.current
    if (!el) return
    const update = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      setSize({ w, h })
      onSizeChange?.(w, h)
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [onSizeChange])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeUnzip()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeUnzip])

  if (evidence.length === 0) return null

  const clipPath = buildRevealClip(size.w, size.h, connectionAngle, animProgress)

  return (
    <div
      ref={popupRef}
      className={`unzip-popup unzip-level-${level}`}
      style={{
        left: `${anchorX}%`,
        top: `${anchorY}%`,
        transform: 'translate(-50%, -50%)',
        clipPath,
      }}
      data-connection={connectionKey}
      onWheel={(e) => {
        e.stopPropagation()
        if (e.deltaY < 0) {
          unzipDeeper()
        } else {
          unzipShallower()
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="unzip-header">
        <span className="unzip-level-badge">L{level}</span>
        <span className="unzip-title">
          {evidence.length} {evidence.length === 1 ? 'study' : 'studies'}
        </span>
        <button className="unzip-close" type="button" onClick={closeUnzip}>
          ×
        </button>
      </div>
      <ul className="unzip-list">
        {evidence.map((study, i) => (
          <li key={i} className="unzip-study">
            <div className="unzip-study-title">{study.title}</div>
            {level >= 2 && (
              <div className="unzip-study-citation">{study.citation}</div>
            )}
            {level >= 3 && (
              <a
                className="unzip-study-url"
                href={study.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {study.url}
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="unzip-hint">
        {level < 3 ? 'Scroll up for more detail' : 'Scroll down to collapse'}
      </div>
    </div>
  )
}
