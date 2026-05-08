/**
 * ConnectionReferencePopup — floating panel that opens above a selected
 * connection and lets the user view / add / edit / remove citation rows.
 * Legacy parity: replaces the `unzipPopup` from
 * `src/old/ui/UnzipPopup.tsx` with a GPU-friendly edge split plus a
 * three-level references panel.
 *
 * Mounted unconditionally by the app shell. Renders nothing unless exactly
 * one edge is selected. Position is recomputed each frame from the renderer
 * camera + edge endpoints so it follows pan/zoom seamlessly.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useOmniStore } from '../model/store'
import type { ConnectionReference } from '../model/types'
import { SCENE_H, SCENE_W } from '../scene/sceneConstants'
import type { SceneRenderer } from '../scene/SceneRenderer'

interface Props {
  renderer: SceneRenderer | null
}

const EMPTY_REF: ConnectionReference = { title: '', citation: '', url: '' }
const UNZIP_OPEN_MS = 400

function buildRevealClip(w: number, h: number, angle: number, progress: number): string {
  const cx = w / 2
  const cy = h / 2
  const diag = Math.sqrt(w * w + h * h) / 2 + 24
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const px = -sinA
  const py = cosA
  const halfAlong = diag
  const halfPerp = diag * progress
  const points = [
    [cx + cosA * halfAlong + px * halfPerp, cy + sinA * halfAlong + py * halfPerp],
    [cx + cosA * halfAlong - px * halfPerp, cy + sinA * halfAlong - py * halfPerp],
    [cx - cosA * halfAlong - px * halfPerp, cy - sinA * halfAlong - py * halfPerp],
    [cx - cosA * halfAlong + px * halfPerp, cy - sinA * halfAlong + py * halfPerp],
  ]
  return `polygon(${points.map(([x, y]) => `${x}px ${y}px`).join(', ')})`
}

function useUnzipProgress(): number {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const start = performance.now()
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / UNZIP_OPEN_MS)
      setProgress(1 - (1 - t) ** 3)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return progress
}

export function ConnectionReferencePopup({ renderer }: Props) {
  // Re-render on store + camera changes so the anchor follows the edge.
  useSyncExternalStore(
    useOmniStore.subscribe,
    () => {
      const s = useOmniStore.getState()
      return s.rev * 65537 + s.selRev + (s.camera.panX | 0) + (s.camera.panY | 0)
    },
    () => 0,
  )
  // Poll for camera/zoom changes that don't bump store rev (free-zoom is
  // store-side, but RMM and dragged camera updates are not always observed
  // synchronously). 30 FPS is enough for popup tracking.
  const [, setPulse] = useState(0)
  useEffect(() => {
    if (!renderer) return
    let raf = 0
    const tick = () => {
      setPulse((p) => (p + 1) & 0xffff)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [renderer])

  const s = useOmniStore.getState()
  if (!renderer) return null
  if (s.selectedEdgeIds.size !== 1) return null
  const edgeId = s.selectedEdgeIds.values().next().value as string
  const edge = s.model.edges.get(edgeId)
  if (!edge) return null
  const a = s.model.nodes.get(edge.from)
  const b = s.model.nodes.get(edge.to)
  if (!a || !b) return null

  // Midpoint in scene-percent → scene pixels → screen pixels via camera.
  const cam = renderer.getCamera()
  const vp = renderer.getViewport()
  const scale = cam.freeScale
  const ax = (a.x / 100) * SCENE_W
  const ay = (a.y / 100) * SCENE_H
  const bx = (b.x / 100) * SCENE_W
  const by = (b.y / 100) * SCENE_H
  const midX = (ax + bx) / 2
  const midY = (ay + by) / 2
  const screenX = vp.width / 2 + (cam.panX + midX) * scale
  const screenY = vp.height / 2 + (cam.panY + midY) * scale
  const angle = Math.atan2(by - ay, bx - ax)

  const refs = edge.references ?? []
  const setRefs = (next: ConnectionReference[]) => {
    useOmniStore.getState().updateEdge(edgeId, { references: next.length > 0 ? next : undefined })
  }
  const close = () => useOmniStore.getState().selectEdge(null)

  return (
    <ReferenceCard
      key={edgeId}
      edgeId={edgeId}
      renderer={renderer}
      x={screenX}
      y={screenY}
      angle={angle}
      refs={refs}
      onChange={setRefs}
      onClose={close}
    />
  )
}

function ReferenceCard({
  edgeId,
  renderer,
  x,
  y,
  angle,
  refs,
  onChange,
  onClose,
}: {
  edgeId: string
  renderer: SceneRenderer
  x: number
  y: number
  angle: number
  refs: ConnectionReference[]
  onChange: (next: ConnectionReference[]) => void
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [adding, setAdding] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState<ConnectionReference>({ ...EMPTY_REF })
  const [level, setLevel] = useState<1 | 2 | 3>(1)
  const [size, setSize] = useState({ w: 300, h: 200 })
  const progress = useUnzipProgress()
  const zoomLevel = (deltaY: number) => {
    setLevel((cur) => {
      if (deltaY < 0) return cur < 3 ? ((cur + 1) as 1 | 2 | 3) : cur
      if (cur > 1) return (cur - 1) as 1 | 2 | 3
      onClose()
      return cur
    })
  }

  // Esc closes the popup (or cancels the in-progress edit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (adding || editingIdx !== null) {
        setAdding(false)
        setEditingIdx(null)
        setDraft({ ...EMPTY_REF })
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding, editingIdx, onClose])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    renderer.setConnectionPopupMetrics(edgeId, { w: size.w, h: size.h, progress })
    return () => renderer.setConnectionPopupMetrics(edgeId, null)
  }, [edgeId, progress, renderer, size.h, size.w])

  const save = () => {
    if (!draft.title.trim()) return
    if (editingIdx !== null) {
      onChange(refs.map((r, i) => (i === editingIdx ? { ...draft } : r)))
      setEditingIdx(null)
    } else {
      onChange([...refs, { ...draft }])
    }
    setAdding(false)
    setDraft({ ...EMPTY_REF })
  }
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Connection references"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        minWidth: 240,
        maxWidth: 360,
        padding: 10,
        background: 'var(--ug-glass-strong)',
        border: '1px solid var(--ug-border)',
        borderRadius: 6,
        boxShadow: '0 4px 16px var(--ug-shadow-heavy)',
        backdropFilter: 'blur(8px)',
        color: 'var(--ug-text)',
        font: '12px system-ui, sans-serif',
        zIndex: 11,
        clipPath: buildRevealClip(size.w, size.h, angle, progress),
        opacity: 0.2 + progress * 0.8,
        transformOrigin: '50% 50%',
      }}
      onWheel={(e) => {
        e.preventDefault()
        e.stopPropagation()
        zoomLevel(e.deltaY)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--ug-text-heading)' }}>
          {refs.length} {refs.length === 1 ? 'reference' : 'references'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--ug-text-muted)', cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      </div>
      {refs.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 6px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {refs.map((r, i) => (
            <li
              key={i}
              style={{
                padding: 6,
                background: 'var(--ug-surface)',
                border: '1px solid var(--ug-border-light)',
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{r.title}</span>
              </div>
              {level >= 2 && r.citation && (
                <div style={{ fontSize: 11, color: 'var(--ug-text-secondary)', marginTop: 2 }}>{r.citation}</div>
              )}
              {level >= 3 && r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--ug-primary)', marginTop: 2, display: 'inline-block', wordBreak: 'break-all' }}
                >
                  {r.url}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            autoFocus
            style={inputStyle}
          />
          <input
            placeholder="Citation"
            value={draft.citation}
            onChange={(e) => setDraft({ ...draft, citation: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="URL"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" onClick={save} style={primaryBtn}>
              {editingIdx !== null ? 'Update' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setEditingIdx(null)
                setDraft({ ...EMPTY_REF })
              }}
              style={ghostBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '4px 6px',
  border: '1px solid var(--ug-border)',
  borderRadius: 3,
  background: 'var(--ug-surface)',
  color: 'var(--ug-text)',
  font: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--ug-primary)',
  color: 'var(--ug-text-on-primary)',
  border: '1px solid var(--ug-primary-dark)',
  borderRadius: 3,
  cursor: 'pointer',
  font: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: 'var(--ug-text)',
  border: '1px solid var(--ug-border)',
  borderRadius: 3,
  cursor: 'pointer',
  font: 'inherit',
}
