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
  'text-generator': ['charsPerSec', 'loop', 'endHoldMs', 'ms'],
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
  'text-generator': { charsPerSec: 24, loop: 0, endHoldMs: 1000, ms: 1500 },
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
}

export function FlowEffectEditor({ initial, onPreview, onSave, onClose }: Props) {
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

  const addNode = (kind: FlowEffectKind) => {
    const id = `n_${Date.now().toString(36)}_${effect.graph.nodes.length}`
    const x = 60 + (effect.graph.nodes.length % 4) * (NODE_W + 30)
    const y = 60 + Math.floor(effect.graph.nodes.length / 4) * (NODE_H + 40)
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

  const onSvgPointerUp = () => {
    const d = dragState.current
    if (d) {
      // Release capture on the *exact* element it was set on, with the real
      // pointer id. Hardcoding either yields a no-op and leaks the capture
      // to the node group, breaking subsequent drags ("drag but no drop").
      try { d.capturedOn?.releasePointerCapture?.(d.pointerId) } catch { /* ignore */ }
      dragState.current = null
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
          <button onClick={() => onPreview(effect)} style={btnStyle}>▶ Preview</button>
          <button onClick={() => onSave(effect)} style={{ ...btnStyle, background: '#2f5a32' }}>Save</button>
          <button onClick={onClose} style={btnStyle}>✕</button>
        </header>
        <div style={bodyStyle}>
          <aside style={sidebarStyle}>
            <div style={{ fontSize: 11, color: '#7a8aa0', marginBottom: 4 }}>Add node</div>
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => addNode(k)}
                style={{ ...btnStyle, justifyContent: 'flex-start', background: KIND_COLORS[k] }}
              >
                + {k}
              </button>
            ))}
            {selected && selected.id !== ENTRY_NODE_ID && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: '#7a8aa0', marginBottom: 4 }}>
                  {selected.kind} params
                </div>
                {PARAM_FIELDS[selected.kind].map((key) => (
                  <ParamField
                    key={key}
                    label={key}
                    value={selected.params[key] ?? 0}
                    isTint={key === 'tint'}
                    onChange={(v) => setParam(selected.id, key, v)}
                  />
                ))}
                <button
                  onClick={() => removeNode(selected.id)}
                  style={{ ...btnStyle, background: '#5a1f1f', borderColor: '#a04040', marginTop: 8 }}
                >
                  Delete node
                </button>
              </div>
            )}
            {pendingFromId && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#cfe' }}>
                Click a node to connect (or
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
          >
            {/* Edges */}
            {effect.graph.edges.map((e) => {
              const a = nodeIndex.get(e.from)
              const b = nodeIndex.get(e.to)
              if (!a || !b) return null
              const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2
              const x2 = b.x, y2 = b.y + NODE_H / 2
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
                  nodeIndex.get(pendingFromId)!.x + NODE_W,
                  nodeIndex.get(pendingFromId)!.y + NODE_H / 2,
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
                  if (pendingFromId) {
                    e.stopPropagation()
                    completeEdge(n.id)
                  } else {
                    startDrag(e, n)
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
                <text x={10} y={22} fill="#fff" fontSize={13} fontWeight={600}>
                  {n.id === ENTRY_NODE_ID ? '▶ entry' : n.kind}
                </text>
                <text x={10} y={42} fill="#cde" fontSize={11}>
                  {n.id === ENTRY_NODE_ID ? '(signal source)' : summariseParams(n)}
                </text>
                {/* Output port */}
                <circle
                  cx={NODE_W}
                  cy={NODE_H / 2}
                  r={6}
                  fill="#cfe"
                  stroke="#456"
                  onPointerDown={(e) => beginEdge(e, n.id)}
                  style={{ cursor: 'crosshair' }}
                />
                {/* Input port (visual only) — entry node has no input. */}
                {n.id !== ENTRY_NODE_ID && (
                  <circle cx={0} cy={NODE_H / 2} r={4} fill="#456" stroke="#cfe" />
                )}              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  )
}

function ParamField({
  label,
  value,
  isTint,
  onChange,
}: {
  label: string
  value: number
  isTint?: boolean
  onChange: (v: number) => void
}) {
  if (isTint) {
    const hex = '#' + (value & 0xffffff).toString(16).padStart(6, '0')
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 11, color: '#bcd', width: 50 }}>{label}</span>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))}
          style={{ width: 36, height: 22, border: 'none', background: 'transparent' }}
        />
      </label>
    )
  }
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <span style={{ fontSize: 11, color: '#bcd', width: 50 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={label === 'ms' ? 50 : 0.1}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={fieldStyle}
      />
    </label>
  )
}

function summariseParams(n: EffectNode): string {
  const parts: string[] = []
  for (const k of PARAM_FIELDS[n.kind]) {
    const v = n.params[k]
    if (v == null) continue
    if (k === 'tint') parts.push(`#${(v & 0xffffff).toString(16).padStart(6, '0')}`)
    else parts.push(`${k}=${v}`)
  }
  return parts.join(' ')
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.4)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
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
  width: 'min(1100px, 90vw)',
  height: 'min(700px, 85vh)',
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
  width: 200,
  padding: 12,
  borderRight: '1px solid #2f3a4a',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflowY: 'auto',
}

const canvasStyle: React.CSSProperties = {
  flex: 1,
  background: '#0e131c',
  cursor: 'default',
  userSelect: 'none',
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
  fontSize: 12,
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
