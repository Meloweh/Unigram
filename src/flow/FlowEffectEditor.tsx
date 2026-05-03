/**
 * Flow effect editor — a small React/SVG modal for authoring `FlowEffect`
 * graphs. Effect graphs are tiny (typically ≤ 10 nodes) so a Pixi
 * sub-renderer would be overkill; plain SVG keeps the implementation small
 * and makes the editor independent of the diagram renderer.
 *
 * The editor mutates a *local* copy; the parent decides whether to play it
 * one-shot or attach it as an always-play loop on save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EffectNode, FlowEffect, FlowEffectKind } from './types'
import { useOmniStore } from '../model/store'
import type { CrossEffectLink } from '../model/types'

/** Stable empty fallback for store selectors — see CrossLinkPanel for why. */
const EMPTY_CROSS_LINKS: readonly CrossEffectLink[] = []


const KINDS: FlowEffectKind[] = [
  'wait',
  'move',
  'scale',
  'color',
  'jitter',
  'float',
  'emerge',
  'dismiss',
  'cloud-levitate',
  'bubble-levitate',
  'repeater',
  'camera',
  'text-generator',
  'record',
  'obs-record',
  'handoff-rmm',
  'return-rmm',
  'handoff-mpd',
  'spawn',
  'spawn-circular',
  'expand',
  'collapse',
]

const NODE_W = 140
const NODE_H = 64

const KIND_COLORS: Record<FlowEffectKind, string> = {
  wait: '#3a4a66',
  move: '#2d5e7e',
  scale: '#5a3d7a',
  color: '#7a4540',
  jitter: '#3f6b3a',
  float: '#356b7a',
  emerge: '#4a7a3a',
  dismiss: '#7a4a3a',
  'cloud-levitate': '#4f5d8a',
  'bubble-levitate': '#7a5b3a',
  repeater: '#5b3a7a',
  camera: '#3a6b5e',
  'text-generator': '#7a4a8a',
  record: '#7a3030',
  'obs-record': '#a04040',
  'handoff-rmm': '#3a6b8a',
  'return-rmm': '#5a8a6b',
  'handoff-mpd': '#8a6b3a',
  spawn: '#3a8a8a',
  'spawn-circular': '#5b8a3a',
  expand: '#5a7a3d',
  collapse: '#7a5a3d',
}

const PARAM_FIELDS: Record<FlowEffectKind, string[]> = {
  wait: ['ms'],
  move: ['dx', 'dy', 'ms', 'roundtrip'],
  scale: ['mul', 'ms', 'permanent'],
  color: ['tint', 'ms', 'permanent'],
  jitter: ['amp', 'ms'],
  float: ['amp', 'freq', 'ms'],
  emerge: ['ms', 'fromScale'],
  dismiss: ['ms', 'toScale'],
  'cloud-levitate': ['ampX', 'ampY', 'freq', 'ms'],
  'bubble-levitate': ['ampY', 'scaleAmp', 'freq', 'ms'],
  repeater: ['times'],
  camera: ['panX', 'panY', 'zoom', 'ms', 'permanent'],
  'text-generator': ['charsPerSec', 'loop', 'endHoldMs', 'startIndex', 'endIndex', 'degenerationMs', 'ms'],
  record: ['ms', 'fps'],
  'obs-record': ['ms'],
  // RMM handoff drives `useOmniStore.rmmZoomStep('in')` until the dial
  // reaches handoff (i.e. swap to host node's child model). `ms` is the
  // visual budget; the renderer steps the dial at ~60 Hz inside it.
  'handoff-rmm': ['ms'],
  // RMM return walks the dial back out, popping one frame off the stack.
  'return-rmm': ['ms'],
  // MPD handoff cycles to the next/previous MPD dimension on the host
  // node. `direction` is +1 (next) or -1 (previous). `ms` controls the
  // curtain animation length.
  'handoff-mpd': ['direction', 'ms'],
  // Spawn N decorative children at random offsets around the host within
  // `radius` (scene-percent). They fade in over `fadeMs`, hold, then fade
  // out when the task ends. `ms` is on-screen lifetime.
  spawn: ['count', 'radius', 'ms', 'fadeMs'],
  // Same as spawn but children land on a regular circle.
  'spawn-circular': ['count', 'radius', 'ms', 'fadeMs'],
  // Grow node by `mul` over `ms` (defaults to 1.5×). `permanent` holds final.
  expand: ['mul', 'ms', 'permanent'],
  // Shrink node by 1/mul over `ms`. `permanent` holds final.
  collapse: ['mul', 'ms', 'permanent'],
}

const DEFAULT_PARAMS: Record<FlowEffectKind, Record<string, number>> = {
  wait: { ms: 500 },
  move: { dx: 4, dy: 0, ms: 400, roundtrip: 0 },
  scale: { mul: 1.3, ms: 250, permanent: 0 },
  color: { tint: 0xff5555, ms: 400, permanent: 0 },
  jitter: { amp: 0.4, ms: 600 },
  float: { amp: 0.5, freq: 1, ms: 2000 },
  emerge: { ms: 400, fromScale: 0 },
  dismiss: { ms: 400, toScale: 0 },
  'cloud-levitate': { ampX: 0.6, ampY: 0.4, freq: 0.6, ms: 4000 },
  'bubble-levitate': { ampY: 0.5, scaleAmp: 0.04, freq: 1, ms: 3000 },
  repeater: { times: 1 },
  camera: { panX: 0, panY: 0, zoom: 1, ms: 600, permanent: 0 },
  'text-generator': { charsPerSec: 24, loop: 0, endHoldMs: 1000, startIndex: 0, endIndex: -1, degenerationMs: 0, ms: 1500 },
  // Record canvas to .webm for `ms` while task is active. `fps` is the
  // capture frame rate; defaults to 30. The recording downloads on stop.
  record: { ms: 5000, fps: 30 },
  // Tell OBS (via WebSocket) to start recording for `ms` while active. The
  // OBS host/port/password are read from the renderer's stored settings.
  'obs-record': { ms: 5000 },
  'handoff-rmm': { ms: 600 },
  'return-rmm': { ms: 600 },
  'handoff-mpd': { direction: 1, ms: 500 },
  spawn: { count: 6, radius: 8, ms: 1500, fadeMs: 300 },
  'spawn-circular': { count: 8, radius: 8, ms: 1500, fadeMs: 300 },
  expand: { mul: 1.5, ms: 400, permanent: 0 },
  collapse: { mul: 1.5, ms: 400, permanent: 0 },
}

/**
 * Friendly metadata per param field, surfaced in the right-side settings
 * panel (tasks F + G). The `kind` decides the input control:
 *   - `number` (default): plain numeric input
 *   - `bool`: 0/1 toggled by a checkbox
 *   - `tint`: 24-bit colour picker
 *   - `enum`: a `<select>` whose option values are listed in `options`
 * `label` overrides the raw param key, `unit` is appended in muted text,
 * `step` overrides the default 0.1 step, `min`/`max` are advisory.
 */
type FieldKind = 'number' | 'bool' | 'tint' | 'enum'
interface FieldMeta {
  label?: string
  hint?: string
  unit?: string
  kind?: FieldKind
  options?: { value: number; label: string }[]
  step?: number
  min?: number
  max?: number
}
const FIELD_META: Record<string, FieldMeta> = {
  ms: { label: 'Duration', unit: 'ms', step: 50, min: 0 },
  dx: { label: 'Δ X', unit: '%' },
  dy: { label: 'Δ Y', unit: '%' },
  mul: { label: 'Multiplier', step: 0.05, min: 0 },
  tint: { label: 'Tint', kind: 'tint' },
  amp: { label: 'Amplitude', step: 0.1 },
  ampX: { label: 'Amp X', step: 0.1 },
  ampY: { label: 'Amp Y', step: 0.1 },
  freq: { label: 'Frequency', unit: 'Hz', step: 0.1, min: 0 },
  scaleAmp: { label: 'Scale amp', step: 0.01 },
  fromScale: { label: 'From scale', step: 0.05, min: 0 },
  toScale: { label: 'To scale', step: 0.05, min: 0 },
  panX: { label: 'Pan X', unit: '%' },
  panY: { label: 'Pan Y', unit: '%' },
  zoom: { label: 'Zoom', step: 0.1, min: 0.01 },
  permanent: { label: 'Hold final state', kind: 'bool' },
  roundtrip: { label: 'Round-trip', kind: 'bool', hint: 'Animate back to start.' },
  loop: { label: 'Loop', kind: 'bool' },
  charsPerSec: { label: 'Chars / sec', step: 1, min: 1 },
  endHoldMs: { label: 'End hold', unit: 'ms', step: 50, min: 0 },
  startIndex: { label: 'Start index', step: 1, min: 0 },
  endIndex: { label: 'End index', step: 1, hint: '-1 = end of string.' },
  degenerationMs: { label: 'Degeneration', unit: 'ms', step: 50, min: 0 },
  fps: { label: 'FPS', step: 1, min: 1 },
  count: { label: 'Count', step: 1, min: 1 },
  radius: { label: 'Radius', unit: '%', step: 0.5, min: 0 },
  fadeMs: { label: 'Fade', unit: 'ms', step: 50, min: 0 },
  times: { label: 'Times', step: 1, min: 1 },
  direction: {
    label: 'Direction',
    kind: 'enum',
    options: [
      { value: 1, label: 'Next' },
      { value: -1, label: 'Previous' },
    ],
  },
}

/** Short human-readable description of each effect kind for the panel header. */
const KIND_HINTS: Partial<Record<FlowEffectKind, string>> = {
  wait: 'Hold the schedule for a fixed duration.',
  move: 'Translate the host node by ΔX/ΔY scene-percent.',
  scale: 'Multiply the host node\u2019s size.',
  color: 'Tint the host node\u2019s fill.',
  jitter: 'Randomly nudge the node within an amplitude.',
  float: 'Sinusoidal vertical bob.',
  emerge: 'Fade + scale the node in from `fromScale`.',
  dismiss: 'Fade + scale the node out to `toScale`.',
  'cloud-levitate': 'Slow XY drift, suited to thinking-cloud nodes.',
  'bubble-levitate': 'Vertical bob with subtle scale pulse.',
  repeater: 'Re-fire the downstream graph N times.',
  camera: 'Pan + zoom the viewport.',
  'text-generator': 'Reveal the node label one character at a time.',
  record: 'Capture the canvas to a .webm for `ms`.',
  'obs-record': 'Trigger OBS recording for `ms`.',
  'handoff-rmm': 'Recursive zoom-in into this node\u2019s child model.',
  'return-rmm': 'Pop one level back out of an RMM stack.',
  'handoff-mpd': 'Cycle MPD dimensions on the host.',
  spawn: 'Burst N decorative children at random offsets.',
  'spawn-circular': 'Burst N decorative children on a circle.',
  expand: 'Grow the node by `mul`.',
  collapse: 'Shrink the node by 1/`mul`.',
}

/**
 * Auto-injected entry node id. The entry node is a `wait` with `ms: 0` that
 * the editor surfaces visually as a signal-source — every fresh effect graph
 * gets one so the user has a clear "play here" anchor (legacy parity, see
 * `src/old/flow/FlowEffectEditor.tsx`). It is filtered out of the runtime
 * via `durationOf` returning 0.
 */
export const ENTRY_NODE_ID = '__entry__'

/** Editor grid step in svg pixels (legacy `GRID = 20`). */
const GRID = 20

/** Snap a coord to the editor grid. */
function snapToGrid(v: number): number {
  return Math.round(v / GRID) * GRID
}

/** Ensure the entry node exists; returns the unchanged effect when present. */
function withEntryNode(effect: FlowEffect): FlowEffect {
  if (effect.graph.nodes.some((n) => n.id === ENTRY_NODE_ID)) return effect
  const entry: EffectNode = {
    id: ENTRY_NODE_ID,
    kind: 'wait',
    x: GRID,
    y: GRID,
    params: { ms: 0 },
  }
  return {
    ...effect,
    graph: {
      ...effect.graph,
      nodes: [entry, ...effect.graph.nodes],
    },
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- helper exported alongside editor component
export function emptyEffect(): FlowEffect {
  return {
    id: `eff_${Date.now().toString(36)}`,
    label: 'New effect',
    graph: { nodes: [], edges: [] },
  }
}

interface Props {
  initial: FlowEffect
  onPreview: (effect: FlowEffect) => void
  onSave: (effect: FlowEffect) => void
  onClose: () => void
  /**
   * Optional host node id this effect graph belongs to. When provided the
   * editor surfaces a "Link Node" button so the user can pair other model
   * nodes with this one (parity item I). Clicking the button arms the
   * canvas-side `pickMode` and closes the modal so the peer can be chosen
   * directly from the main view.
   */
  hostNodeId?: string
  /**
   * Called when the user clicks "Link Node". The parent should save the
   * passed-in effect state, hide the editor, and arm canvas pick mode;
   * once the link is recorded the editor can be re-opened with the saved
   * state preserved.
   */
  onLinkPick?: (effect: FlowEffect) => void
}

export function FlowEffectEditor({ initial, onSave, onClose, hostNodeId, onLinkPick }: Props) {
  const [effect, setEffect] = useState<FlowEffect>(() => withEntryNode(deepClone(initial)))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingFromId, setPendingFromId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const dragState = useRef<{ id: string; offX: number; offY: number; pointerId: number; capturedOn: Element | null } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Delete' && selectedId) {
        removeNode(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const selected = selectedId ? effect.graph.nodes.find((n) => n.id === selectedId) ?? null : null

  const addNode = (kind: FlowEffectKind, atX?: number, atY?: number) => {
    const id = `n_${Date.now().toString(36)}_${effect.graph.nodes.length}`
    let x: number
    let y: number
    if (atX != null && atY != null) {
      // Drop position from sidebar drag — snap to grid so the dropped node
      // lines up with existing wires.
      x = snapToGrid(atX - NODE_W / 2)
      y = snapToGrid(atY - NODE_H / 2)
    } else {
      // Vertical layout: stack new nodes top-to-bottom in a single column
      // (legacy Unigram parity). Wraps to a second column once the column
      // would extend past ~6 rows.
      const ROW = NODE_H + GRID * 2
      const COL = NODE_W + GRID * 2
      const PER_COL = 6
      const idx = effect.graph.nodes.length
      x = GRID + Math.floor(idx / PER_COL) * COL
      y = GRID + ((idx % PER_COL) + 1) * ROW
    }
    const node: EffectNode = { id, kind, x, y, params: { ...DEFAULT_PARAMS[kind] } }
    setEffect((e) => ({ ...e, graph: { ...e.graph, nodes: [...e.graph.nodes, node] } }))
    setSelectedId(id)
  }

  const removeNode = (id: string) => {
    if (id === ENTRY_NODE_ID) return // entry node is permanent
    setEffect((e) => ({
      ...e,
      graph: {
        nodes: e.graph.nodes.filter((n) => n.id !== id),
        edges: e.graph.edges.filter((ed) => ed.from !== id && ed.to !== id),
      },
    }))
    setSelectedId((s) => (s === id ? null : s))
  }

  const setParam = (id: string, key: string, val: number) => {
    setEffect((e) => ({
      ...e,
      graph: {
        ...e.graph,
        nodes: e.graph.nodes.map((n) =>
          n.id === id ? { ...n, params: { ...n.params, [key]: val } } : n,
        ),
      },
    }))
  }

  const moveNode = (id: string, x: number, y: number) => {
    // Snap to the editor grid so manually positioned nodes line up cleanly.
    const sx = snapToGrid(x)
    const sy = snapToGrid(y)
    setEffect((e) => ({
      ...e,
      graph: {
        ...e.graph,
        nodes: e.graph.nodes.map((n) => (n.id === id ? { ...n, x: sx, y: sy } : n)),
      },
    }))
  }

  const toggleEdge = (from: string, to: string) => {
    if (from === to) return
    setEffect((e) => {
      const exists = e.graph.edges.some((ed) => ed.from === from && ed.to === to)
      const edges = exists
        ? e.graph.edges.filter((ed) => !(ed.from === from && ed.to === to))
        : [...e.graph.edges, { from, to }]
      return { ...e, graph: { ...e.graph, edges } }
    })
  }

  const onSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (dragState.current) {
      const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
      moveNode(dragState.current.id, pt.x - dragState.current.offX, pt.y - dragState.current.offY)
    } else if (pendingFromId) {
      const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
      setCursor(pt)
    }
  }, [pendingFromId])

  const onSvgPointerUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    const d = dragState.current
    if (d) {
      // Release capture on the *exact* element it was set on, with the real
      // pointer id. Hardcoding either yields a no-op and leaks the capture
      // to the node group, breaking subsequent drags ("drag but no drop").
      try { d.capturedOn?.releasePointerCapture?.(d.pointerId) } catch { /* ignore */ }
      dragState.current = null
    }
    // Wire-drop: when a wire is being drawn (pendingFromId) and the user
    // releases the mouse with no node-up handler having claimed the event,
    // cancel the pending wire (parity with task D — release attaches if
    // over a node, else cancels).
    if (pendingFromId && e) {
      cancelEdge()
    }
  }

  const startDrag = (e: React.PointerEvent, n: EffectNode) => {
    if (pendingFromId) return // edge mode takes precedence
    e.stopPropagation()
    setSelectedId(n.id)
    const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
    const target = e.currentTarget as Element
    dragState.current = {
      id: n.id,
      offX: pt.x - n.x,
      offY: pt.y - n.y,
      pointerId: e.pointerId,
      capturedOn: target,
    }
    target.setPointerCapture(e.pointerId)
  }

  const beginEdge = (e: React.PointerEvent, from: string) => {
    e.stopPropagation()
    setPendingFromId(from)
    setCursor(svgPoint(svgRef.current!, e.clientX, e.clientY))
  }

  const completeEdge = (toId: string) => {
    if (!pendingFromId) return
    toggleEdge(pendingFromId, toId)
    setPendingFromId(null)
    setCursor(null)
  }

  const cancelEdge = () => {
    setPendingFromId(null)
    setCursor(null)
  }

  const nodeIndex = useMemo(() => {
    const m = new Map<string, EffectNode>()
    for (const n of effect.graph.nodes) m.set(n.id, n)
    return m
  }, [effect.graph.nodes])

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <input
            value={effect.label}
            onChange={(e) => setEffect((cur) => ({ ...cur, label: e.target.value }))}
            style={titleInputStyle}
            placeholder="Effect name"
          />
          <div style={{ flex: 1 }} />
          {hostNodeId && <LinkPicker hostNodeId={hostNodeId} onPick={() => onLinkPick?.(effect)} />}
          <button onClick={() => onSave(effect)} style={{ ...btnStyle, background: '#2f5a32' }}>Save</button>
          <button onClick={onClose} style={btnStyle}>✕</button>
        </header>
        <div style={bodyStyle}>
          <aside style={sidebarStyle}>
            <div style={{ fontSize: 13, color: '#7a8aa0', marginBottom: 4 }}>Add node</div>
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => addNode(k)}
                draggable
                onDragStart={(e) => {
                  // Carry the kind through dataTransfer so the canvas
                  // drop handler can spawn the matching node at the
                  // pointer location.
                  e.dataTransfer.setData('application/omnigram-effect-kind', k)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                style={{ ...btnStyle, justifyContent: 'flex-start', background: KIND_COLORS[k], cursor: 'grab' }}
              >
                + {k}
              </button>
            ))}
            {pendingFromId && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#cfe' }}>
                Drag onto a node to connect (or
                <button onClick={cancelEdge} style={{ ...btnStyle, marginLeft: 6, padding: '2px 6px' }}>
                  cancel
                </button>
                )
              </div>
            )}
          </aside>
          <svg
            ref={svgRef}
            style={canvasStyle}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerDown={() => {
              setSelectedId(null)
              cancelEdge()
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/omnigram-effect-kind')) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={(e) => {
              const kind = e.dataTransfer.getData('application/omnigram-effect-kind') as FlowEffectKind | ''
              if (!kind) return
              e.preventDefault()
              const pt = svgPoint(svgRef.current!, e.clientX, e.clientY)
              addNode(kind, pt.x, pt.y)
            }}
          >
            {/* Edges */}
            {effect.graph.edges.map((e) => {
              const a = nodeIndex.get(e.from)
              const b = nodeIndex.get(e.to)
              if (!a || !b) return null
              // Vertical wires: bottom of `a` → top of `b`.
              const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H
              const x2 = b.x + NODE_W / 2, y2 = b.y
              return (
                <g key={`${e.from}->${e.to}`}>
                  <path
                    d={curvePath(x1, y1, x2, y2)}
                    fill="none"
                    stroke="#88a"
                    strokeWidth={2}
                    onClick={() => toggleEdge(e.from, e.to)}
                    style={{ cursor: 'pointer' }}
                  />
                </g>
              )
            })}
            {/* Pending edge */}
            {pendingFromId && cursor && nodeIndex.get(pendingFromId) && (
              <path
                d={curvePath(
                  nodeIndex.get(pendingFromId)!.x + NODE_W / 2,
                  nodeIndex.get(pendingFromId)!.y + NODE_H,
                  cursor.x,
                  cursor.y,
                )}
                fill="none"
                stroke="#cfe"
                strokeWidth={2}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
            {/* Nodes */}
            {effect.graph.nodes.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onPointerDown={(e) => {
                  // Wire-attach is now release-driven (task D); pointerdown
                  // on a node always starts a drag.
                  startDrag(e, n)
                }}
                onPointerUp={(e) => {
                  // If a wire is being drawn, release-on-node attaches it.
                  if (pendingFromId && pendingFromId !== n.id) {
                    e.stopPropagation()
                    completeEdge(n.id)
                  }
                }}
                style={{ cursor: pendingFromId ? 'crosshair' : 'grab' }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill={KIND_COLORS[n.kind]}
                  stroke={selectedId === n.id ? '#cfe' : '#456'}
                  strokeWidth={selectedId === n.id ? 2 : 1}
                />
                <text x={10} y={22} fill="#fff" fontSize={14} fontWeight={600}>
                  {n.id === ENTRY_NODE_ID ? '▶ entry' : n.kind}
                </text>
                {/* Output port (bottom edge) */}
                <circle
                  cx={NODE_W / 2}
                  cy={NODE_H}
                  r={6}
                  fill="#cfe"
                  stroke="#456"
                  onPointerDown={(e) => beginEdge(e, n.id)}
                  style={{ cursor: 'crosshair' }}
                />
                {/* Input port (top edge; visual only) — entry node has no input. */}
                {n.id !== ENTRY_NODE_ID && (
                  <circle cx={NODE_W / 2} cy={0} r={4} fill="#456" stroke="#cfe" />
                )}              </g>
            ))}
          </svg>
          {hostNodeId && <PeerPane hostNodeId={hostNodeId} />}
          <aside style={rightSidebarStyle}>
            {selected ? (
              <NodeSettingsPanel
                node={selected}
                onChangeParam={(k, v) => setParam(selected.id, k, v)}
                onDelete={() => removeNode(selected.id)}
              />
            ) : (
              <div style={{ fontSize: 13, color: '#7a8aa0' }}>
                Select an effect node to edit its settings.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function NodeSettingsPanel({
  node,
  onChangeParam,
  onDelete,
}: {
  node: EffectNode
  onChangeParam: (key: string, value: number) => void
  onDelete: () => void
}) {
  if (node.id === ENTRY_NODE_ID) {
    return (
      <>
        <div style={{ fontSize: 14, color: '#dde', fontWeight: 600 }}>Entry node</div>
        <div style={{ fontSize: 13, color: '#7a8aa0', marginTop: 4 }}>
          The signal source. Connect downstream effect nodes to its bottom port.
        </div>
      </>
    )
  }
  const fields = PARAM_FIELDS[node.kind]
  const hint = KIND_HINTS[node.kind]
  return (
    <>
      <div style={{ fontSize: 14, color: '#dde', fontWeight: 600, textTransform: 'capitalize' }}>
        {node.kind.replace(/-/g, ' ')}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: '#7a8aa0', marginTop: 2, marginBottom: 6 }}>{hint}</div>
      )}
      {fields.map((key) => (
        <ParamField
          key={key}
          fieldKey={key}
          value={node.params[key] ?? 0}
          onChange={(v) => onChangeParam(key, v)}
        />
      ))}
      <button
        onClick={onDelete}
        style={{ ...btnStyle, background: '#5a1f1f', borderColor: '#a04040', marginTop: 12 }}
      >
        Delete node
      </button>
    </>
  )
}

function ParamField({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string
  value: number
  onChange: (v: number) => void
}) {
  const meta = FIELD_META[fieldKey] ?? {}
  const label = meta.label ?? fieldKey
  const kind: FieldKind = meta.kind ?? 'number'
  if (kind === 'bool') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <input
          type="checkbox"
          checked={value !== 0}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        />
        <span style={{ fontSize: 13, color: '#bcd' }}>{label}</span>
        {meta.hint && (
          <span style={{ fontSize: 11, color: '#7a8aa0' }}>({meta.hint})</span>
        )}
      </label>
    )
  }
  if (kind === 'tint') {
    const hex = '#' + (value & 0xffffff).toString(16).padStart(6, '0')
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>{label}</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))}
          style={{ width: 36, height: 22, border: 'none', background: 'transparent' }}
        />
      </label>
    )
  }
  if (kind === 'enum') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={fieldStyle}
        >
          {meta.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  // Default: number input.
  const step = meta.step ?? (fieldKey === 'ms' ? 50 : 0.1)
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <span style={{ fontSize: 13, color: '#bcd', width: 90 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={meta.min}
        max={meta.max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={fieldStyle}
      />
      {meta.unit && (
        <span style={{ fontSize: 11, color: '#7a8aa0' }}>{meta.unit}</span>
      )}
    </label>
  )
}

function summariseParams(): string {
  // Retained for potential future tooltip use; in-membrane settings labels
  // were removed per task H so this is currently unreferenced.
  return ''
}
// Suppress unused-export lint warning — kept for future use.
void summariseParams

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  // Vertical S-curve: pull control points along the y-axis so wires read
  // top-to-bottom. Falls back to a small offset for near-zero spans.
  const dy = Math.max(40, Math.abs(y2 - y1) * 0.4)
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  const sp = pt.matrixTransform(ctm.inverse())
  return { x: sp.x, y: sp.y }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
}

const modalStyle: React.CSSProperties = {
  // Doubled relative to the previous min(1100,90vw) / min(700,85vh) sizing so
  // the editor canvas has enough room for vertical-stacked graphs.
  width: 'min(2200px, 95vw)',
  height: 'min(1400px, 95vh)',
  background: '#1a1f2a',
  border: '1px solid #2f3a4a',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: '#dde',
  fontFamily: 'system-ui, sans-serif',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid #2f3a4a',
  background: '#222a38',
}

const bodyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
}

const sidebarStyle: React.CSSProperties = {
  // Widened proportionally to the doubled modal so the kind buttons +
  // param fields still breathe.
  width: 240,
  padding: 12,
  borderRight: '1px solid #2f3a4a',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflowY: 'auto',
}

const rightSidebarStyle: React.CSSProperties = {
  // Mirror of `sidebarStyle` but anchored to the right edge of the modal
  // body (tasks F + G). Hosts per-effect-node settings for the current
  // selection.
  width: 280,
  padding: 12,
  borderLeft: '1px solid #2f3a4a',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  background: '#161c26',
}

const canvasStyle: React.CSSProperties = {
  flex: 1,
  background: '#0e131c',
  cursor: 'default',
  userSelect: 'none',
}

const peerPaneStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  borderLeft: '2px dashed #2f3a4a',
  minWidth: 0,
}

const peerPaneHeaderStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#161c26',
  borderBottom: '1px solid #2f3a4a',
  display: 'flex',
  alignItems: 'center',
}

const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  background: '#2c3548',
  border: '1px solid #455168',
  borderRadius: 4,
  color: '#dde',
  fontSize: 14,
  cursor: 'pointer',
}

const titleInputStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  color: '#fff',
  font: '600 14px system-ui, sans-serif',
  padding: '4px 6px',
  outline: 'none',
}

const fieldStyle: React.CSSProperties = {
  flex: 1,
  background: '#0e131c',
  border: '1px solid #2f3a4a',
  color: '#dde',
  padding: '3px 6px',
  borderRadius: 3,
  fontSize: 12,
  width: 70,
}

/**
 * "Link Node" button shown in the editor header. Clicking it puts the
 * canvas into one-shot `pickMode = 'link-node'` and notifies the parent
 * (via `onPick`) so the editor can be hidden during the pick and then
 * reopened once a peer has been chosen on the canvas (parity with legacy
 * Unigram). The host node is forced into the active selection so
 * `PointerController`'s pick handler can resolve the source.
 */
function LinkPicker({ hostNodeId, onPick }: { hostNodeId: string; onPick: () => void }) {
  // Read peer state from the store so the button text + handler stay in
  // sync with `host.linkedNodeIds`. Single subscription via selector so we
  // re-render only when the peer set changes.
  const linked = useOmniStore((s) => s.model.nodes.get(hostNodeId)?.linkedNodeIds ?? EMPTY_LINKED)
  const hasPeer = linked.length > 0
  if (hasPeer) {
    return (
      <button
        type="button"
        onClick={() => {
          const store = useOmniStore.getState()
          // Symmetric unlink for every paired peer (matches legacy parity:
          // "Unlink Node" tears down the split-screen pairing).
          for (const peerId of [...linked]) {
            store.unlinkNodes(hostNodeId, peerId)
          }
        }}
        style={{ ...btnStyle, padding: '4px 10px', background: '#5a3a2a' }}
        title="Tear down the split-screen pairing"
      >
        Unlink Node
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        const store = useOmniStore.getState()
        // Ensure the host is the sole selection so PointerController's
        // pick-mode handler picks it as the link source.
        store.select(hostNodeId, false)
        store.setPickMode('link-node')
        onPick()
      }}
      style={{ ...btnStyle, padding: '4px 10px' }}
      title="Click a node on the canvas to link it to this one"
    >
      Link Node
    </button>
  )
}

const EMPTY_LINKED: readonly string[] = []

/**
 * Split-screen peer pane. When the host node is paired with another via
 * `linkedNodeIds`, render a read-only SVG view of the peer\u2019s primary
 * effect graph next to the main canvas (legacy Unigram parity).
 *
 * Cross-links between effects are shown as dashed orange wires terminating
 * at the peer\u2019s entry node \u2014 a visual indicator that lines up with the
 * dragged-cross-wire pattern from legacy without requiring drag-drop
 * across panes (which the runtime does not yet support in Omnigram).
 */
function PeerPane({ hostNodeId }: { hostNodeId: string }) {
  const linked = useOmniStore((s) => s.model.nodes.get(hostNodeId)?.linkedNodeIds ?? EMPTY_LINKED)
  const peerNode = useOmniStore((s) => (linked[0] ? s.model.nodes.get(linked[0]) : null))
  if (!peerNode) return null
  const peerEffect = peerNode.flowEffects?.[0]
  return (
    <div style={peerPaneStyle}>
      <div style={peerPaneHeaderStyle}>
        <span style={{ fontSize: 13, color: '#60a5fa', fontWeight: 600 }}>
          Peer: {peerNode.label || peerNode.id}
        </span>
        {peerEffect && (
          <span style={{ fontSize: 12, color: '#7a8aa0', marginLeft: 6 }}>
            \u00b7 {peerEffect.label}
          </span>
        )}
      </div>
      {peerEffect ? (
        <svg style={canvasStyle}>
          {peerEffect.graph.edges.map((e) => {
            const a = peerEffect.graph.nodes.find((n) => n.id === e.from)
            const b = peerEffect.graph.nodes.find((n) => n.id === e.to)
            if (!a || !b) return null
            const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H
            const x2 = b.x + NODE_W / 2, y2 = b.y
            return (
              <path
                key={`${e.from}->${e.to}`}
                d={curvePath(x1, y1, x2, y2)}
                fill="none"
                stroke="#88a"
                strokeWidth={2}
              />
            )
          })}
          {peerEffect.graph.nodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={KIND_COLORS[n.kind]}
                stroke="#456"
                strokeWidth={1}
              />
              <text x={10} y={22} fill="#fff" fontSize={14} fontWeight={600}>
                {n.id === ENTRY_NODE_ID ? '\u25b6 entry' : n.kind}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#556677', fontSize: 13 }}>
          (peer has no effect graph yet)
        </div>
      )}
    </div>
  )
}

/**
 * Renders dashed stubs along the right edge of the editor canvas, one per
 * outgoing cross-link from the active effect. Pure visual aid — clicking
 * does nothing (manage links from the sidebar panel).
 */
function CrossLinkOverlay({ hostNodeId, effectId }: { hostNodeId: string; effectId: string }) {
  const nodes = useOmniStore((s) => s.model.nodes)
  const crossLinksRaw = useOmniStore((s) => s.model.crossLinks)
  const crossLinks = crossLinksRaw ?? EMPTY_CROSS_LINKS
  const outgoing = crossLinks.filter(
    (l) => l.from.nodeId === hostNodeId && l.from.effectId === effectId,
  )
  if (outgoing.length === 0) return null
  // Anchor stubs at a pinned x just inside the canvas right edge so they
  // remain visible at any scroll position. The viewBox is the SVG's
  // intrinsic coords which we don't strictly know here; pick a generous x
  // that still works on the doubled-size modal.
  const x = 1900
  return (
    <g pointerEvents="none">
      {outgoing.map((l, i) => {
        const peer = nodes.get(l.to.nodeId)
        const peerEff = peer?.flowEffects?.find((e) => e.id === l.to.effectId)
        const y = 60 + i * 28
        return (
          <g key={l.id} transform={`translate(${x},${y})`}>
            <line x1={-80} y1={0} x2={0} y2={0} stroke="#cfa544" strokeWidth={2} strokeDasharray="6 4" />
            <circle cx={0} cy={0} r={5} fill="#cfa544" />
            <text x={-86} y={4} fill="#cfa544" fontSize={14} textAnchor="end" fontWeight={600}>
              {peer?.label || l.to.nodeId} · {peerEff?.label || l.to.effectId}
            </text>
          </g>
        )
      })}
    </g>
  )
}
// Suppress unused-export lint warning \u2014 retained for future cross-link UX.
void CrossLinkOverlay
