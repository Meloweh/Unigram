import { useEffect, useRef, useState } from 'react'
import type { StudyEvidence } from '../model/sampleModels'
import { useHybridZoomStore, type UnzipLevel } from '../model/useHybridZoomStore'

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
  onUpdateEvidence?: (evidence: StudyEvidence[]) => void
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

const emptyEntry: StudyEvidence = { title: '', citation: '', url: '' }

export function UnzipPopup({
  connectionKey, level, evidence, anchorX, anchorY, animProgress, connectionAngle, onSizeChange, onUpdateEvidence,
}: UnzipPopupProps) {
  const { closeUnzip, unzipDeeper, unzipShallower } = useHybridZoomStore.getState()
  const popupRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 200 })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<StudyEvidence>({ ...emptyEntry })
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

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
      if (e.key === 'Escape') {
        if (adding || editingIdx !== null) {
          setAdding(false)
          setEditingIdx(null)
          setDraft({ ...emptyEntry })
        } else {
          closeUnzip()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeUnzip, adding, editingIdx])

  const handleSave = () => {
    if (!draft.title.trim()) return
    if (editingIdx !== null) {
      const updated = evidence.map((e, i) => i === editingIdx ? { ...draft } : e)
      onUpdateEvidence?.(updated)
      setEditingIdx(null)
    } else {
      onUpdateEvidence?.([...evidence, { ...draft }])
    }
    setDraft({ ...emptyEntry })
    setAdding(false)
  }

  const handleRemove = (idx: number) => {
    onUpdateEvidence?.(evidence.filter((_, i) => i !== idx))
    if (editingIdx === idx) {
      setEditingIdx(null)
      setDraft({ ...emptyEntry })
    }
  }

  const handleEdit = (idx: number) => {
    setEditingIdx(idx)
    setDraft({ ...evidence[idx] })
    setAdding(true)
  }

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
      {evidence.length > 0 && (
        <ul className="unzip-list">
          {evidence.map((study, i) => (
            <li key={i} className="unzip-study">
              <div className="unzip-study-title">
                {study.title}
                {onUpdateEvidence && (
                  <span className="unzip-study-actions">
                    <button type="button" className="unzip-action-btn" onClick={() => handleEdit(i)} title="Edit">✎</button>
                    <button type="button" className="unzip-action-btn" onClick={() => handleRemove(i)} title="Remove">×</button>
                  </span>
                )}
              </div>
              {level >= 2 && (
                <div className="unzip-study-citation">{study.citation}</div>
              )}
              {level >= 3 && study.url && (
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
      )}
      {adding && onUpdateEvidence ? (
        <div className="unzip-add-form">
          <input
            className="unzip-add-input"
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            autoFocus
          />
          <input
            className="unzip-add-input"
            placeholder="Citation"
            value={draft.citation}
            onChange={(e) => setDraft({ ...draft, citation: e.target.value })}
          />
          <input
            className="unzip-add-input"
            placeholder="URL"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <div className="unzip-add-buttons">
            <button type="button" className="unzip-add-save" onClick={handleSave}>
              {editingIdx !== null ? 'Update' : 'Add'}
            </button>
            <button type="button" className="unzip-add-cancel" onClick={() => {
              setAdding(false)
              setEditingIdx(null)
              setDraft({ ...emptyEntry })
            }}>Cancel</button>
          </div>
        </div>
      ) : onUpdateEvidence ? (
        <button
          type="button"
          className="unzip-add-btn"
          onClick={() => { setAdding(true); setEditingIdx(null); setDraft({ ...emptyEntry }) }}
        >
          + Add reference
        </button>
      ) : null}
      <div className="unzip-hint">
        {level < 3 ? 'Scroll up for more detail' : 'Scroll down to collapse'}
      </div>
    </div>
  )
}
