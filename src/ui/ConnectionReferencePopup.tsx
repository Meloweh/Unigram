/**
 * ConnectionReferencePopup — floating panel that opens above a selected
 * connection and lets the user view / add / edit / remove citation rows.
 * Legacy parity: replaces the unzip popup with a GPU-friendly floating
 * three-level references panel.
 *
 * Mounted unconditionally by the app shell. Renders nothing unless exactly
 * one edge is selected. Position is recomputed each frame from the renderer
 * camera + edge endpoints so it follows pan/zoom seamlessly.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useOmniStore } from '../model/store'
import type { ConnectionReference } from '../model/types'
import { SCENE_H, SCENE_W } from '../scene/sceneConstants'
import type { SceneRenderer } from '../scene/SceneRenderer'

interface Props {
  renderer: SceneRenderer | null
}

const EMPTY_REF: ConnectionReference = { title: '', citation: '', url: '' }
const UNZIP_OPEN_MS = 400
const VOTE_BADGE_MS = 5000
const MAX_POPUP_ZOOM_SCALE = 5

function useZipProgress(closing: boolean, onClosed: () => void): number {
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const onClosedRef = useRef(onClosed)

  useEffect(() => {
    onClosedRef.current = onClosed
  }, [onClosed])

  useEffect(() => {
    const from = progressRef.current
    const to = closing ? 0 : 1
    const start = performance.now()
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / UNZIP_OPEN_MS)
      const eased = 1 - (1 - t) ** 3
      const next = from + (to - from) * eased
      progressRef.current = next
      setProgress(next)
      if (t < 1) raf = requestAnimationFrame(tick)
      else if (closing) onClosedRef.current()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [closing])
  return progress
}

function useVoteBadgeAnimation(): { progress: number; alpha: number } {
  const startedRef = useRef(0)
  const [state, setState] = useState({ progress: 0, alpha: 0 })

  useEffect(() => {
    startedRef.current = performance.now()
    let raf = 0
    const tick = () => {
      const now = performance.now()
      const elapsed = now - startedRef.current
      const remaining = VOTE_BADGE_MS - elapsed
      const open = Math.min(1, Math.max(0, elapsed / 180))
      const close = remaining < 360 ? Math.max(0, remaining / 360) : 1
      const progress = easeOutCubic(open) * easeInOut(close)
      const alpha = 0.94 * Math.min(1, open * 1.4) * close
      setState({ progress, alpha })
      if (remaining > 0) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return state
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
  const popupScale = Math.max(0.9, Math.min(MAX_POPUP_ZOOM_SCALE, scale))

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
      popupScale={popupScale}
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
  popupScale,
  refs,
  onChange,
  onClose,
}: {
  edgeId: string
  renderer: SceneRenderer
  x: number
  y: number
  angle: number
  popupScale: number
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
  const [closing, setClosing] = useState(false)
  const progress = useZipProgress(closing, onClose)
  const voteBadge = useVoteBadgeAnimation()
  const requestClose = useCallback(() => {
    if (!closing) setClosing(true)
  }, [closing])
  const zoomLevel = (deltaY: number) => {
    setLevel((cur) => {
      if (deltaY < 0) return cur < 3 ? ((cur + 1) as 1 | 2 | 3) : cur
      if (cur > 1) return (cur - 1) as 1 | 2 | 3
      requestClose()
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
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding, editingIdx, requestClose])

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
    renderer.setConnectionPopupMetrics(edgeId, { w: size.w * popupScale, h: size.h * popupScale, progress })
    return () => renderer.setConnectionPopupMetrics(edgeId, null)
  }, [edgeId, popupScale, progress, renderer, size.h, size.w])

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
  const settledOpen = !closing && progress >= 0.995
  const votes = renderer.getSocialVoteBreakdown('edge', edgeId)
  const voteOpacity = voteBadge.alpha * Math.max(0, Math.min(1, (progress - 0.82) / 0.18))
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${popupScale})`,
        transformOrigin: '50% 50%',
        pointerEvents: progress < 0.08 ? 'none' : 'auto',
        zIndex: 11,
      }}
      onWheel={(e) => {
        e.preventDefault()
        e.stopPropagation()
        zoomLevel(e.deltaY)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          transform: settledOpen
            ? 'none'
            : `rotate(${angle}rad) scaleX(${Math.max(0.04, progress)})`,
          transformOrigin: '50% 50%',
          opacity: progress <= 0.01 ? 0 : 1,
          willChange: settledOpen ? undefined : 'transform, opacity',
        }}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Connection references"
          style={{
            transform: settledOpen ? 'none' : `rotate(${-angle}rad)`,
            transformOrigin: '50% 50%',
          overflow: 'hidden',
          minWidth: 240,
          maxWidth: 360,
          padding: 10,
            background: 'var(--ug-surface)',
          border: '1px solid var(--ug-border)',
          borderRadius: 6,
          boxShadow: '0 4px 16px var(--ug-shadow-heavy)',
          color: 'var(--ug-text)',
          font: '12px system-ui, sans-serif',
          }}
        >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: 'var(--ug-text-heading)' }}>
          {refs.length} {refs.length === 1 ? 'reference' : 'references'}
        </span>
        <button
          type="button"
          onClick={requestClose}
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
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft({ ...EMPTY_REF })
            setEditingIdx(null)
            setAdding(true)
          }}
          style={primaryBtn}
        >
          + Add reference
        </button>
      )}
        </div>
      </div>
      {voteOpacity > 0 && (
        <ReferenceVoteBadge
          votes={votes}
          progress={voteBadge.progress}
          alpha={voteOpacity}
          left={size.w / 2 + 7}
        />
      )}
    </div>
  )
}

function ReferenceVoteBadge({
  votes,
  progress,
  alpha,
  left,
}: {
  votes: { positive: number; negative: number }
  progress: number
  alpha: number
  left: number
}) {
  const fullW = 50
  const rowH = 22
  const w = Math.max(0, fullW * progress)
  const showText = progress >= 0.72
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `calc(50% + ${left}px)`,
        top: '50%',
        transform: 'translateY(-50%)',
        opacity: alpha,
        width: w,
        height: rowH * 2 + 2,
        overflow: 'hidden',
        pointerEvents: 'none',
        border: '1px solid #b8cbe0',
        borderRadius: 6,
        background: '#f7fbff',
        boxSizing: 'border-box',
        boxShadow: '0 4px 10px var(--ug-shadow)',
      }}
    >
      <div style={voteRowStyle('positive', rowH, fullW, showText)}>
        + {votes.positive}
      </div>
      <div style={voteRowStyle('negative', rowH, fullW, showText)}>
        - {votes.negative}
      </div>
    </div>
  )
}

function voteRowStyle(kind: 'positive' | 'negative', rowH: number, fullW: number, showText: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: 3,
    top: kind === 'positive' ? 3 : rowH + 3,
    width: Math.max(0, fullW - 6),
    height: rowH - 4,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 4,
    background: kind === 'positive' ? '#e1f4e7' : '#f7dfdc',
    color: showText ? kind === 'positive' ? '#247a3a' : '#9b2f2a' : 'transparent',
    font: '800 12.5px/1 system-ui, sans-serif',
    whiteSpace: 'nowrap',
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

const inputStyle: CSSProperties = {
  padding: '4px 6px',
  border: '1px solid var(--ug-border)',
  borderRadius: 3,
  background: 'var(--ug-surface)',
  color: 'var(--ug-text)',
  font: 'inherit',
}
const primaryBtn: CSSProperties = {
  padding: '4px 10px',
  background: 'var(--ug-primary)',
  color: 'var(--ug-text-on-primary)',
  border: '1px solid var(--ug-primary-dark)',
  borderRadius: 3,
  cursor: 'pointer',
  font: 'inherit',
}
const ghostBtn: CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: 'var(--ug-text)',
  border: '1px solid var(--ug-border)',
  borderRadius: 3,
  cursor: 'pointer',
  font: 'inherit',
}
