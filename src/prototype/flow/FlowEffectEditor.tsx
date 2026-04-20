import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowEffect, FlowEffectKind, EffectGraphNode, EffectGraphEdge, EffectPortId, CosmeticType } from '../model/sampleModels'
import { FlowNodeConfigPanel } from './FlowNodeConfigPanel'

// ---- Host context passed from viewport ----

export interface EffectEditorHostContext {
  /** The ID of the host diagram node */
  hostNodeId: string
  /** Whether the host diagram node has a childModelId (can RMM-zoom into it) */
  hasChildModel: boolean
  /** Whether we're currently inside a child model (stack depth > 1) */
  isInsideChildModel: boolean
  /** MPD IDs available on the host node (empty if none) */
  mpdIds: string[]
  /** Labels for MPD models keyed by model ID */
  mpdLabels: Record<string, string>
  /** The media type of the host node (undefined if not a media node) */
  mediaType?: string
  /** The cosmetic type of the host node (undefined if not a cosmetic node) */
  cosmeticType?: CosmeticType
}

// ---- Spawn item type ----

export interface MoveWaypoint {
  dx: number
  dy: number
  durationMs: number
}

export interface SpawnItem {
  label: string
  offsetX: number
  offsetY: number
  animation: 'emerge' | 'zip-in'
  connectionType: 'none' | 'default' | 'flow'
}

export interface SpawnCircularItem {
  label: string
  animation: 'emerge' | 'zip-in'
  connectionType: 'none' | 'default' | 'flow'
}

// ---- Constants ----

const NODE_W = 160
const NODE_H = 56
const PORT_R = 6
const GRID = 20

export const kindLabels: Record<FlowEffectKind, string> = {
  'entry': 'Signal In',
  'wait': 'Wait',
  'move': 'Move',
  'color': 'Color',
  'spawn': 'Spawn',
  'spawn-circular': 'Spawn Circular',
  'play-media': 'Play media',
  'handoff-rmm': 'Handoff to RMM',
  'return-rmm': 'Return from RMM',
  'handoff-mpd': 'Handoff to MPD',
  'camera': 'Camera',
  'break': 'Break Apart',
  'expand': 'Expand',
  'collapse': 'Collapse',
  'record': '⏺ Record',
  'jitter': 'Jitter',
  'float': 'Float',
  'emerge': 'Emerge',
  'dismiss': 'Dismiss',
  'scale': 'Scale',
  'text-format': 'Text Format',
  'repeater': 'Repeater',
  'cloud-levitate': 'Cloudy Levitate',
  'bubble-levitate': 'Soap Bubble Levitate',
  'text-generator': 'Text Generator',
  'segment-play': 'Segment Play',
  'audio-clip': 'Audio Clip',
}

export const kindColors: Record<FlowEffectKind, string> = {
  'entry': '#38bdf8',
  'wait': '#6366f1',
  'move': '#10b981',
  'color': '#f59e0b',
  'spawn': '#ec4899',
  'spawn-circular': '#f472b6',
  'play-media': '#f97316',
  'handoff-rmm': '#a78bfa',
  'return-rmm': '#c084fc',
  'handoff-mpd': '#2dd4bf',
  'camera': '#818cf8',
  'break': '#f87171',
  'expand': '#22c55e',
  'collapse': '#ef4444',
  'record': '#dc2626',
  'jitter': '#fb923c',
  'float': '#67e8f9',
  'emerge': '#a3e635',
  'dismiss': '#fb923c',
  'scale': '#34d399',
  'text-format': '#e879f9',
  'repeater': '#facc15',
  'cloud-levitate': '#94a3b8',
  'bubble-levitate': '#7dd3fc',
  'text-generator': '#c084fc',
  'segment-play': '#fb923c',
  'audio-clip': '#f97316',
}

const ENTRY_NODE_ID = '__entry__'

/** Ensures the graph has an entry signal node. Returns [nodes, edges] with entry guaranteed. */
function ensureEntryNode(nodes: EffectGraphNode[], edges: EffectGraphEdge[]): [EffectGraphNode[], EffectGraphEdge[]] {
  if (nodes.some(n => n.kind === 'entry')) return [nodes, edges]
  const entryNode: EffectGraphNode = {
    id: ENTRY_NODE_ID,
    kind: 'entry',
    label: 'Signal In',
    x: 60,
    y: 120,
    config: {},
  }
  return [[entryNode, ...nodes], edges]
}

// ---- Default configs ----

function defaultConfig(kind: FlowEffectKind): Record<string, unknown> {
  switch (kind) {
    case 'entry': return { triggeredByRmmParent: false }
    case 'wait': return { durationMs: 500 }
    case 'move': return { waypoints: [{ dx: 0, dy: 0, durationMs: 500 }], roundtrip: false, keepPlaying: false }
    case 'color': return { color: '#f59e0b', durationMs: 300, permanent: false, keepPlaying: false }
    case 'spawn': return { spawnItems: [] }
    case 'play-media': return {}
    case 'handoff-rmm': return {}
    case 'return-rmm': return {}
    case 'handoff-mpd': return { targetMpdId: '' }
    case 'camera': return { panX: 0, panY: 0, zoom: 1, rotation: 0, durationMs: 1000, panXDurationMs: 1000, panYDurationMs: 1000, zoomDurationMs: 1000, rotationDurationMs: 1000, panXResetMode: 'attr', panYResetMode: 'attr', zoomResetMode: 'attr', rotationResetMode: 'attr', panXEasing: 'ease-out', panYEasing: 'ease-out', zoomEasing: 'ease-out', rotationEasing: 'ease-out' }
    case 'break': return { axis: 'horizontal', shakeIntensity: 8, shakeDurationMs: 300, fallDurationMs: 600 }
    case 'expand': return { durationMs: 300 }
    case 'collapse': return { durationMs: 300 }
    case 'record': return { recordMode: 'browser', captureMode: 'tab', hideCursor: true, recordingWidth: 1920, recordingHeight: 1080, videoBitrateMbps: 32, codec: 'vp9', fps: 30, obsHost: 'localhost', obsPort: 4455, obsPassword: '' }
    case 'jitter': return { intensity: 4, durationMs: 1000, keepPlaying: false }
    case 'float': return { amplitude: 6, speed: 1, durationMs: 3000, keepPlaying: false }
    case 'spawn-circular': return { spawnCircularItems: [], distance: 120, delayBetweenMs: 200 }
    case 'emerge': return { animation: 'scale-in', durationMs: 600 }
    case 'dismiss': return { animation: 'scale-out', durationMs: 600 }
    case 'scale': return { targetWidth: 200, targetHeight: 120, durationMs: 500, persistent: false, keepPlaying: false }
    case 'text-format': return { targetMode: 'indices', startIndex: 0, endIndex: 0, startSubstring: '', endSubstring: '', bold: false, italic: false, strikethrough: false, color: '', fontSize: 0, rescaleDurationMs: 0, resetMode: 'node', durationMs: 1000, keepPlaying: false, levitateStyle: 'none' }
    case 'repeater': return { repeatCount: 3 }
    case 'cloud-levitate': return { amplitude: 8, speed: 0.8, durationMs: 3000 }
    case 'bubble-levitate': return { amplitude: 10, speed: 0.5, durationMs: 4000, scalePulse: true }
    case 'text-generator': return { targetMode: 'indices', startIndex: 0, endIndex: 0, startSubstring: '', endSubstring: '', speed: 50, mode: 'letter', soundPreset: 'none', useNodeDuration: false, nodeDurationMs: 1000, useDegeneration: false, degenerationDurationMs: 0 }
    case 'segment-play': return { startTime: 0, endTime: 0 }
    case 'audio-clip': return { clipKey: '' }
  }
}

// ---- Helpers ----

function snapToGridVal(v: number) {
  return Math.round(v / GRID) * GRID
}

function portPos(node: EffectGraphNode, side: 'in' | 'out', port?: EffectPortId) {
  if (node.kind === 'repeater' && port) {
    const x = port === 'default' ? node.x + NODE_W * 0.25 : node.x + NODE_W * 0.75
    return { x, y: side === 'in' ? node.y : node.y + NODE_H }
  }
  return {
    x: node.x + NODE_W / 2,
    y: side === 'in' ? node.y : node.y + NODE_H,
  }
}

function uid() {
  return `gn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// ---- Cross-pane draft type (lifted to parent) ----
interface CrossPaneDraft {
  sourcePane: 'primary' | 'peer'
  fromId: string
  fromPort?: EffectPortId
  /** Client-space mouse position */
  clientX: number
  clientY: number
}

// ---- Canvas Pane (extracted to avoid duplication in split-screen mode) ----

function EffectCanvasPane({
  paneId,
  nodes, setNodes,
  edges, setEdges,
  selectedNodeId, onSelectNode,
  pan, setPan,
  isNodeLocked,
  onFocus,
  label,
  labelColor,
  // Cross-pane draft callbacks
  onCrossDraftStart,
  onCrossDraftMove,
  onCrossDraftEnd,
  incomingCrossDraft,
  canvasRef: externalCanvasRef,
  allowedKinds,
}: {
  paneId: string
  nodes: EffectGraphNode[]
  setNodes: React.Dispatch<React.SetStateAction<EffectGraphNode[]>>
  edges: EffectGraphEdge[]
  setEdges: React.Dispatch<React.SetStateAction<EffectGraphEdge[]>>
  selectedNodeId: string | null
  onSelectNode: (id: string | null) => void
  pan: { x: number; y: number }
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  isNodeLocked: (n: EffectGraphNode) => boolean
  onFocus?: () => void
  label?: string
  labelColor?: string
  onCrossDraftStart?: (fromId: string, fromPort: EffectPortId | undefined) => void
  onCrossDraftMove?: (clientX: number, clientY: number) => void
  onCrossDraftEnd?: () => void
  incomingCrossDraft?: { clientX: number; clientY: number } | null
  canvasRef?: React.RefObject<HTMLDivElement | null>
  allowedKinds?: Set<FlowEffectKind>
}) {
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [edgeDraft, setEdgeDraft] = useState<{ fromId: string; fromPort?: EffectPortId; mx: number; my: number } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null)
  const internalCanvasRef = useRef<HTMLDivElement>(null)
  const canvasRefActual = externalCanvasRef ?? internalCanvasRef
  const patternId = `fxgrid-${paneId}`

  // Refs for values used inside window-level listeners (avoids stale closures)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const panRef2 = useRef(pan)
  panRef2.current = pan

  const toGraph = useCallback((e: React.MouseEvent | MouseEvent) => {
    const rect = canvasRefActual.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left - pan.x, y: e.clientY - rect.top - pan.y }
  }, [pan])

  const onNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onFocus?.()
    onSelectNode(nodeId)
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y }
  }, [nodes, onSelectNode, onFocus])

  const edgeDraftRef = useRef<{ fromId: string; fromPort?: EffectPortId } | null>(null)

  // Stable refs for cross-draft callbacks (avoids re-creating window listeners)
  const onCrossDraftStartRef = useRef(onCrossDraftStart)
  onCrossDraftStartRef.current = onCrossDraftStart
  const onCrossDraftMoveRef = useRef(onCrossDraftMove)
  onCrossDraftMoveRef.current = onCrossDraftMove
  const onCrossDraftEndRef = useRef(onCrossDraftEnd)
  onCrossDraftEndRef.current = onCrossDraftEnd

  const onPortPointerDown = useCallback((e: React.PointerEvent, nodeId: string, port?: EffectPortId) => {
    e.stopPropagation()
    e.preventDefault()
    onFocus?.()
    const gp = toGraph(e)
    setEdgeDraft({ fromId: nodeId, fromPort: port, mx: gp.x, my: gp.y })
    edgeDraftRef.current = { fromId: nodeId, fromPort: port }
    onCrossDraftStartRef.current?.(nodeId, port)
    // Capture pointer to the canvas so all subsequent move/up events
    // are dispatched here (works across panes and outside the port element)
    canvasRefActual.current?.setPointerCapture(e.pointerId)
  }, [toGraph, onFocus])

  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) return
    if (e.button === 0) {
      onFocus?.()
      onSelectNode(null)
      panRef.current = { startX: e.clientX, startY: e.clientY, origPanX: pan.x, origPanY: pan.y }
    }
  }, [pan, onSelectNode, onFocus])

  const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    // Edge draft dragging (pointer captured to this canvas)
    if (edgeDraftRef.current) {
      const rect = canvasRefActual.current?.getBoundingClientRect()
      if (!rect) return
      const curPan = panRef2.current
      const mx = e.clientX - rect.left - curPan.x
      const my = e.clientY - rect.top - curPan.y
      setEdgeDraft(prev => prev ? { ...prev, mx, my } : null)
      onCrossDraftMoveRef.current?.(e.clientX, e.clientY)
      return
    }
    if (dragRef.current) {
      const { nodeId, startX, startY, origX, origY } = dragRef.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const nx = snapToGridVal(origX + dx)
      const ny = snapToGridVal(origY + dy)
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, x: nx, y: ny } : n))
      return
    }
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX
      const dy = e.clientY - panRef.current.startY
      setPan({ x: panRef.current.origPanX + dx, y: panRef.current.origPanY + dy })
    }
  }, [setNodes, setPan])

  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    // Edge draft completion (pointer was captured to this canvas)
    if (edgeDraftRef.current) {
      const draft = edgeDraftRef.current
      const curPan = panRef2.current
      const curNodes = nodesRef.current
      const curEdges = edgesRef.current

      // Check if drop is over this pane → same-pane edge
      const rect = canvasRefActual.current?.getBoundingClientRect()
      if (rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const gx = e.clientX - rect.left - curPan.x
        const gy = e.clientY - rect.top - curPan.y
        let bestTarget: { node: EffectGraphNode; port?: EffectPortId; dist: number } | null = null
        for (const n of curNodes) {
          if (n.kind === 'entry') continue
          if (n.id === draft.fromId && n.kind !== 'repeater') continue
          if (n.kind === 'repeater') {
            for (const p of ['default', 'circuit'] as EffectPortId[]) {
              if (n.id === draft.fromId && (draft.fromPort !== 'circuit' || p !== 'circuit')) continue
              const ip = portPos(n, 'in', p)
              const dist = Math.hypot(gx - ip.x, gy - ip.y)
              if (dist < PORT_R * 3 && (!bestTarget || dist < bestTarget.dist)) {
                bestTarget = { node: n, port: p, dist }
              }
            }
          } else {
            if (n.id === draft.fromId) continue
            const ip = portPos(n, 'in')
            const dist = Math.hypot(gx - ip.x, gy - ip.y)
            if (dist < PORT_R * 3 && (!bestTarget || dist < bestTarget.dist)) {
              bestTarget = { node: n, dist }
            }
          }
        }
        if (bestTarget) {
          const { node: target, port: toPort } = bestTarget
          const exists = curEdges.some(ed =>
            ed.from === draft.fromId && ed.to === target.id &&
            (ed.fromPort ?? undefined) === draft.fromPort &&
            (ed.toPort ?? undefined) === toPort
          )
          if (!exists) {
            const newEdge: EffectGraphEdge = { from: draft.fromId, to: target.id }
            if (draft.fromPort) newEdge.fromPort = draft.fromPort
            if (toPort) newEdge.toPort = toPort
            setEdges(prev => [...prev, newEdge])
          }
        }
      }
      // Always resolve cross-draft
      onCrossDraftEndRef.current?.()
      edgeDraftRef.current = null
      setEdgeDraft(null)
      return
    }
    if (dragRef.current) {
      dragRef.current = null
      return
    }
    panRef.current = null
  }, [setEdges])

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const kind = e.dataTransfer.getData('application/fxnode-kind') as FlowEffectKind
    if (!kind) return
    // Reject if this kind isn't allowed on this pane
    if (allowedKinds && !allowedKinds.has(kind)) return
    const rect = canvasRefActual.current?.getBoundingClientRect()
    if (!rect) return
    const gx = e.clientX - rect.left - pan.x
    const gy = e.clientY - rect.top - pan.y
    const node: EffectGraphNode = {
      id: uid(),
      kind,
      label: kindLabels[kind],
      x: snapToGridVal(gx - NODE_W / 2),
      y: snapToGridVal(gy - NODE_H / 2),
      config: defaultConfig(kind),
    }
    onFocus?.()
    setNodes(prev => [...prev, node])
    onSelectNode(node.id)
  }, [pan, setNodes, onSelectNode, onFocus, allowedKinds])

  const deleteEdge = useCallback((from: string, to: string, fromPort?: EffectPortId, toPort?: EffectPortId) => {
    setEdges(prev => prev.filter(e => !(e.from === from && e.to === to && (e.fromPort ?? undefined) === fromPort && (e.toPort ?? undefined) === toPort)))
  }, [setEdges])

  return (
    <div
      className="fxeditor-canvas"
      ref={canvasRefActual}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
    >
      {label && (
        <div className="fxeditor-canvas-label" style={{ color: labelColor }}>{label}</div>
      )}
      <svg className="fxeditor-grid" width="100%" height="100%">
        <defs>
          <pattern id={patternId} width={GRID} height={GRID} patternUnits="userSpaceOnUse"
            x={pan.x % GRID} y={pan.y % GRID}>
            <circle cx={GRID / 2} cy={GRID / 2} r="1" fill="rgba(255,255,255,0.08)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>

      <div className="fxeditor-pan" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        <svg className="fxeditor-edges" style={{ position: 'absolute', top: 0, left: 0, width: 10000, height: 10000 }}>
          <defs>
            <marker id={`fxarrow-${paneId}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
            </marker>
          </defs>
          {edges.map(edge => {
            const fromNode = nodes.find(n => n.id === edge.from)
            const toNode = nodes.find(n => n.id === edge.to)
            if (!fromNode || !toNode) return null
            const fp = portPos(fromNode, 'out', edge.fromPort)
            const tp = portPos(toNode, 'in', edge.toPort)
            const midY = (fp.y + tp.y) / 2
            return (
              <g key={`${edge.from}->${edge.to}:${edge.fromPort ?? ''}:${edge.toPort ?? ''}`}
                className="fxeditor-edge-g"
                onClick={(e) => { e.stopPropagation(); deleteEdge(edge.from, edge.to, edge.fromPort, edge.toPort) }}>
                <path
                  d={`M${fp.x},${fp.y} C${fp.x},${midY} ${tp.x},${midY} ${tp.x},${tp.y}`}
                  stroke="#94a3b8" strokeWidth={2} fill="none" markerEnd={`url(#fxarrow-${paneId})`}
                />
                <path
                  d={`M${fp.x},${fp.y} C${fp.x},${midY} ${tp.x},${midY} ${tp.x},${tp.y}`}
                  stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: 'pointer' }}
                />
              </g>
            )
          })}
          {edgeDraft && (() => {
            const fromNode = nodes.find(n => n.id === edgeDraft.fromId)
            if (!fromNode) return null
            const fp = portPos(fromNode, 'out', edgeDraft.fromPort)
            const midY = (fp.y + edgeDraft.my) / 2
            return (
              <path
                d={`M${fp.x},${fp.y} C${fp.x},${midY} ${edgeDraft.mx},${midY} ${edgeDraft.mx},${edgeDraft.my}`}
                stroke="#60a5fa" strokeWidth={2} fill="none" strokeDasharray="5,5"
              />
            )
          })()}
          {/* Incoming cross-pane draft: render purple dashed line from cursor to nearest input port */}
          {incomingCrossDraft && (() => {
            const rect = canvasRefActual.current?.getBoundingClientRect()
            if (!rect) return null
            const mx = incomingCrossDraft.clientX - rect.left - pan.x
            const my = incomingCrossDraft.clientY - rect.top - pan.y
            // Find nearest input port
            let nearest: { x: number; y: number; dist: number } | null = null
            for (const n of nodes) {
              if (n.kind === 'entry') continue
              const ip = portPos(n, 'in')
              const dist = Math.hypot(mx - ip.x, my - ip.y)
              if (!nearest || dist < nearest.dist) nearest = { x: ip.x, y: ip.y, dist }
            }
            // Snap to nearest port if close enough
            const tx = nearest && nearest.dist < PORT_R * 4 ? nearest.x : mx
            const ty = nearest && nearest.dist < PORT_R * 4 ? nearest.y : my
            const midY = (my + ty) / 2
            return (
              <path
                d={`M${mx},${my} C${mx},${midY} ${tx},${midY} ${tx},${ty}`}
                stroke="#c084fc" strokeWidth={2} fill="none" strokeDasharray="6,4"
              />
            )
          })()}
        </svg>

        {nodes.map(node => {
          const color = kindColors[node.kind]
          const isSelected = node.id === selectedNodeId
          const locked = isNodeLocked(node)
          const isEntry = node.kind === 'entry'
          const isRepeater = node.kind === 'repeater'
          return (
            <div
              key={node.id}
              className={`fxeditor-node${isSelected ? ' selected' : ''}${locked ? ' locked' : ''}${isEntry ? ' entry' : ''}`}
              style={{
                left: node.x, top: node.y,
                width: NODE_W, height: NODE_H,
                borderColor: isSelected ? '#60a5fa' : color,
              }}
              onPointerDown={(e) => onNodePointerDown(e, node.id)}
            >
              {isRepeater ? (
                <>
                  <div className="fxeditor-port in port-default" style={{ background: color, left: '25%' }} />
                  <div className="fxeditor-port in port-circuit" style={{ background: color, left: '75%' }} />
                </>
              ) : !isEntry ? (
                <div className="fxeditor-port in" style={{ background: color }} />
              ) : null}
              <div className="fxeditor-node-kind" style={{ color }}>{kindLabels[node.kind]}</div>
              <div className="fxeditor-node-label">{node.label}</div>
              {locked && !isEntry && <div className="fxeditor-lock-badge">🔒</div>}
              {isRepeater ? (
                <>
                  <div className="fxeditor-port out port-default" style={{ background: color, left: '25%' }}
                    onPointerDown={(e) => onPortPointerDown(e, node.id, 'default')} />
                  <div className="fxeditor-port out port-circuit" style={{ background: color, left: '75%' }}
                    onPointerDown={(e) => onPortPointerDown(e, node.id, 'circuit')} />
                </>
              ) : (
                <div className="fxeditor-port out" style={{ background: color }}
                  onPointerDown={(e) => onPortPointerDown(e, node.id)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Component ----

export function FlowEffectEditor({
  effect,
  hostContext,
  onSave,
  onClose,
  peerEffect,
  peerHostContext,
  onSavePeer,
  onRequestPeer,
  onUnlinkPeer,
  onSyncPreviewFacades,
}: {
  effect: FlowEffect
  hostContext: EffectEditorHostContext
  onSave: (updated: FlowEffect) => void
  onClose: () => void
  peerEffect?: FlowEffect
  peerHostContext?: EffectEditorHostContext
  onSavePeer?: (updated: FlowEffect) => void
  onRequestPeer?: () => void
  onUnlinkPeer?: (cleanedEffect: FlowEffect, cleanedPeerEffect?: FlowEffect) => void
  onSyncPreviewFacades?: (hostNodeId: string, graphNodeId: string, items: SpawnItem[]) => void
}) {
  // Build the addable kinds based on host context (and peer context in split view)
  const kindsForCtx = (ctx: EffectEditorHostContext): FlowEffectKind[] => {
    const isCont = ctx.mediaType === 'markdown' || ctx.mediaType === 'math'
    return [
      'wait', 'move', 'color', 'spawn', 'spawn-circular', 'emerge', 'dismiss', 'jitter', 'float', 'scale', 'camera', 'break', 'record', 'text-format', 'text-generator', 'repeater',
      ...(isCont ? ['expand' as const, 'collapse' as const] : []),
      ...(ctx.hasChildModel ? ['handoff-rmm' as const] : []),
      ...(ctx.isInsideChildModel ? ['return-rmm' as const] : []),
      ...(ctx.mpdIds.length > 1 ? ['handoff-mpd' as const] : []),
      ...(ctx.cosmeticType === 'thinking-cloud' ? ['cloud-levitate' as const] : []),
      ...(ctx.cosmeticType === 'chat-bubble' ? ['bubble-levitate' as const] : []),
      ...(ctx.mediaType === 'video' ? ['segment-play' as const] : []),
      ...(ctx.mediaType === 'audio' ? ['audio-clip' as const] : []),
    ]
  }
  const primaryKinds = kindsForCtx(hostContext)
  const peerKinds = peerHostContext ? kindsForCtx(peerHostContext) : []
  // Union of both contexts' kinds (deduplicated, preserves order)
  const addableKinds: FlowEffectKind[] = [...primaryKinds]
  for (const k of peerKinds) { if (!addableKinds.includes(k)) addableKinds.push(k) }
  // Sets for quick lookup of per-pane compatibility
  const primaryKindSet = new Set(primaryKinds)
  const peerKindSet = new Set(peerKinds)

  // ---- Primary graph state ----
  const [nodes, setNodes] = useState<EffectGraphNode[]>(() => {
    const [n] = ensureEntryNode(effect.graph.nodes, effect.graph.edges)
    return n
  })
  const [edges, setEdges] = useState<EffectGraphEdge[]>(() => {
    const [, e] = ensureEntryNode(effect.graph.nodes, effect.graph.edges)
    return e
  })
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // ---- Peer (split-screen) state ----
  const hasPeer = !!(peerEffect && peerHostContext)
  const [peerNodes, setPeerNodes] = useState<EffectGraphNode[]>(() => {
    if (!peerEffect) return []
    const [n] = ensureEntryNode(peerEffect.graph.nodes, peerEffect.graph.edges)
    return n
  })
  const [peerEdges, setPeerEdges] = useState<EffectGraphEdge[]>(() => {
    if (!peerEffect) return []
    const [, e] = ensureEntryNode(peerEffect.graph.nodes, peerEffect.graph.edges)
    return e
  })
  const hasCrossEdges = hasPeer && (
    edges.some(e => !!e.crossNodeId) || peerEdges.some(e => !!e.crossNodeId)
  )

  const [peerSelectedNodeId, setPeerSelectedNodeId] = useState<string | null>(null)
  const [peerPan, setPeerPan] = useState({ x: 0, y: 0 })
  const [activePane, setActivePane] = useState<'primary' | 'peer'>('primary')

  // ---- Cross-pane edge draft (bridges both panes) ----
  const [crossDraft, setCrossDraft] = useState<CrossPaneDraft | null>(null)
  const crossDraftRef = useRef<CrossPaneDraft | null>(null)
  crossDraftRef.current = crossDraft
  const primaryCanvasRef = useRef<HTMLDivElement>(null)
  const peerCanvasRef = useRef<HTMLDivElement>(null)

  // Force a re-render after mount so cross-edge overlay can read canvas rects
  const [, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Resolve cross-pane drop: find nearest input port in the receiving pane
  const resolveCrossDrop = useCallback((draft: CrossPaneDraft) => {
    const receivingPaneIsP = draft.sourcePane === 'peer'
    const receivingNodes = receivingPaneIsP ? nodes : peerNodes
    const receivingPan = receivingPaneIsP ? pan : peerPan
    const receivingRef = receivingPaneIsP ? primaryCanvasRef : peerCanvasRef
    const rect = receivingRef.current?.getBoundingClientRect()
    if (!rect) return

    // Convert client coords to graph coords for the receiving pane
    const gx = draft.clientX - rect.left - receivingPan.x
    const gy = draft.clientY - rect.top - receivingPan.y

    // Find best target input port
    let bestTarget: { node: EffectGraphNode; port?: EffectPortId; dist: number } | null = null
    for (const n of receivingNodes) {
      if (n.kind === 'entry') continue
      if (n.kind === 'repeater') {
        for (const p of ['default', 'circuit'] as EffectPortId[]) {
          const ip = portPos(n, 'in', p)
          const dist = Math.hypot(gx - ip.x, gy - ip.y)
          if (dist < PORT_R * 3 && (!bestTarget || dist < bestTarget.dist)) {
            bestTarget = { node: n, port: p, dist }
          }
        }
      } else {
        const ip = portPos(n, 'in')
        const dist = Math.hypot(gx - ip.x, gy - ip.y)
        if (dist < PORT_R * 3 && (!bestTarget || dist < bestTarget.dist)) {
          bestTarget = { node: n, dist }
        }
      }
    }

    if (bestTarget) {
      // Create cross-edge in the source pane's edges
      const setSourceEdges = draft.sourcePane === 'primary' ? setEdges : setPeerEdges
      const crossNodeId = draft.sourcePane === 'primary' ? peerHostContext!.hostNodeId : hostContext.hostNodeId
      const newEdge: EffectGraphEdge = {
        from: draft.fromId,
        to: bestTarget.node.id,
        crossNodeId,
      }
      if (draft.fromPort) newEdge.fromPort = draft.fromPort
      if (bestTarget.port) newEdge.toPort = bestTarget.port
      setSourceEdges(prev => {
        const exists = prev.some(e => e.from === newEdge.from && e.to === newEdge.to && e.crossNodeId === newEdge.crossNodeId)
        if (exists) return prev
        return [...prev, newEdge]
      })
    }
  }, [nodes, peerNodes, pan, peerPan, hostContext, peerHostContext])

  // ---- Active pane accessors for config panel ----
  const curNodes = activePane === 'peer' ? peerNodes : nodes
  const setCurNodes = activePane === 'peer' ? setPeerNodes : setNodes
  const curSelectedId = activePane === 'peer' ? peerSelectedNodeId : selectedNodeId
  const setCurSelectedId = activePane === 'peer' ? setPeerSelectedNodeId : setSelectedNodeId
  const curEdges = activePane === 'peer' ? peerEdges : edges
  const setCurEdges = activePane === 'peer' ? setPeerEdges : setEdges
  const curHostContext = activePane === 'peer' && peerHostContext ? peerHostContext : hostContext
  const curEffect = activePane === 'peer' && peerEffect ? peerEffect : effect

  // ---- Check if a node is undeletable ----
  const isNodeLocked = useCallback((node: EffectGraphNode) => {
    if (node.kind === 'entry') return true
    if (curEffect.locked && node.kind === 'play-media') return true
    return false
  }, [curEffect.locked])

  // ---- Delete selected node (active pane) ----
  const deleteSelected = useCallback(() => {
    if (!curSelectedId) return
    const node = curNodes.find(n => n.id === curSelectedId)
    if (!node || isNodeLocked(node)) return
    // If deleting a spawn node, remove its preview facades
    if (node.kind === 'spawn' && onSyncPreviewFacades) {
      onSyncPreviewFacades(curHostContext.hostNodeId, curSelectedId, [])
    }
    setCurNodes(prev => prev.filter(n => n.id !== curSelectedId))
    setCurEdges(prev => prev.filter(e => e.from !== curSelectedId && e.to !== curSelectedId))
    // Also remove cross-edges in the OTHER pane that target this node
    const setOtherEdges = activePane === 'peer' ? setEdges : setPeerEdges
    setOtherEdges(prev => prev.filter(e => !(e.crossNodeId && e.to === curSelectedId)))
    setCurSelectedId(null)
  }, [curSelectedId, curNodes, isNodeLocked, setCurNodes, setCurEdges, setCurSelectedId, onSyncPreviewFacades, curHostContext, activePane, setEdges, setPeerEdges])

  // ---- Add node (active pane) ----
  const addNode = useCallback((kind: FlowEffectKind) => {
    const node: EffectGraphNode = {
      id: uid(),
      kind,
      label: kindLabels[kind],
      x: snapToGridVal(200 - NODE_W / 2),
      y: snapToGridVal(200 - NODE_H / 2),
      config: defaultConfig(kind),
    }
    // In split view, redirect to the compatible pane if current pane doesn't support this kind
    const curAllowed = activePane === 'peer' ? peerKindSet : primaryKindSet
    const otherAllowed = activePane === 'peer' ? primaryKindSet : peerKindSet
    if (hasPeer && !curAllowed.has(kind) && otherAllowed.has(kind)) {
      const otherSetNodes = activePane === 'peer' ? setNodes : setPeerNodes
      const otherSetSelId = activePane === 'peer' ? setSelectedNodeId : setPeerSelectedNodeId
      otherSetNodes(prev => [...prev, node])
      otherSetSelId(node.id)
      if (activePane === 'peer') {
        setPeerSelectedNodeId(null); setActivePane('primary')
      } else {
        setSelectedNodeId(null); setActivePane('peer')
      }
    } else {
      setCurNodes(prev => [...prev, node])
      setCurSelectedId(node.id)
    }
  }, [setCurNodes, setCurSelectedId, activePane, hasPeer, primaryKindSet, peerKindSet, setNodes, setPeerNodes, setSelectedNodeId, setPeerSelectedNodeId, setActivePane])

  // ---- Keyboard ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((e.target as HTMLElement).tagName === 'INPUT') return
        deleteSelected()
      }
      if (e.key === 'Escape') {
        onClose()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (!curSelectedId) return
        const node = curNodes.find(n => n.id === curSelectedId)
        if (!node || node.kind === 'entry') return
        try {
          const payload = JSON.stringify({ __fxNodeCopy: true, kind: node.kind, config: node.config, label: node.label })
          navigator.clipboard.writeText(payload)
        } catch { /* clipboard access denied */ }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if ((e.target as HTMLElement).tagName === 'INPUT') return
        navigator.clipboard.readText().then(text => {
          try {
            const data = JSON.parse(text)
            if (!data?.__fxNodeCopy || !data.kind) return
            const node: EffectGraphNode = {
              id: uid(),
              kind: data.kind,
              label: data.label ?? kindLabels[data.kind as FlowEffectKind] ?? data.kind,
              x: snapToGridVal(220 - NODE_W / 2),
              y: snapToGridVal(220 - NODE_H / 2),
              config: data.config ?? defaultConfig(data.kind),
            }
            setCurNodes(prev => [...prev, node])
            setCurSelectedId(node.id)
          } catch { /* not valid paste data */ }
        }).catch(() => { /* clipboard access denied */ })
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [deleteSelected, onClose, curSelectedId, curNodes, setCurNodes, setCurSelectedId])

  // ---- Properties panel for active pane's selected node ----
  const selectedNode = curNodes.find(n => n.id === curSelectedId) ?? null

  const updateNodeConfig = useCallback((key: string, value: unknown) => {
    if (!curSelectedId) return
    setCurNodes(prev => prev.map(n =>
      n.id === curSelectedId
        ? { ...n, config: { ...n.config, [key]: value } }
        : n
    ))
  }, [curSelectedId, setCurNodes])

  // ---- Save ----
  const handleSave = useCallback(() => {
    onSave({ ...effect, graph: { nodes, edges } })
    if (hasPeer && onSavePeer && peerEffect) {
      onSavePeer({ ...peerEffect, graph: { nodes: peerNodes, edges: peerEdges } })
    }
  }, [effect, nodes, edges, onSave, hasPeer, onSavePeer, peerEffect, peerNodes, peerEdges])

  // ---- Render ----
  return (
    <div className="fxeditor-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="fxeditor-modal">
        {/* Header */}
        <div className="fxeditor-header">
          <span className="fxeditor-title">
            Effect Graph: {effect.label}
            {hasPeer && peerEffect && <> &amp; {peerEffect.label}</>}
          </span>
          <div className="fxeditor-header-actions">
            {onRequestPeer && !hasPeer && (
              <button type="button" className="fxeditor-link-btn" onClick={onRequestPeer}>Link Node</button>
            )}
            {hasPeer && onUnlinkPeer && (
              <button type="button" className="fxeditor-link-btn" disabled={!!hasCrossEdges}
                title={hasCrossEdges ? 'Delete all cross-connections first' : undefined}
                onClick={() => {
                  const cleanedEffect = { ...effect, graph: { nodes, edges } }
                  const cleanedPeer = peerEffect ? { ...peerEffect, graph: { nodes: peerNodes, edges: peerEdges } } : undefined
                  onUnlinkPeer(cleanedEffect, cleanedPeer)
                }}>Unlink Node</button>
            )}
            <button type="button" className="fxeditor-save-btn" onClick={handleSave}>Save</button>
            <button type="button" className="fxeditor-close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="fxeditor-body">
          {/* Primary canvas */}
          <EffectCanvasPane
            paneId="primary"
            nodes={nodes}
            setNodes={setNodes}
            edges={edges}
            setEdges={setEdges}
            selectedNodeId={activePane === 'primary' ? selectedNodeId : null}
            onSelectNode={(id) => {
              setSelectedNodeId(id)
              if (hasPeer) { setPeerSelectedNodeId(null); setActivePane('primary') }
            }}
            pan={pan}
            setPan={setPan}
            isNodeLocked={isNodeLocked}
            onFocus={() => { if (hasPeer) { setPeerSelectedNodeId(null); setActivePane('primary') } }}
            label={hasPeer ? effect.label : undefined}
            labelColor={hasPeer ? '#60a5fa' : undefined}
            canvasRef={primaryCanvasRef}
            onCrossDraftStart={hasPeer ? (fromId, fromPort) => setCrossDraft({ sourcePane: 'primary', fromId, fromPort, clientX: 0, clientY: 0 }) : undefined}
            onCrossDraftMove={hasPeer ? (cx, cy) => setCrossDraft(prev => prev ? { ...prev, clientX: cx, clientY: cy } : null) : undefined}
            onCrossDraftEnd={hasPeer ? () => { const d = crossDraftRef.current; if (d) { resolveCrossDrop(d); setCrossDraft(null) } } : undefined}
            incomingCrossDraft={crossDraft && crossDraft.sourcePane === 'peer' ? crossDraft : null}
            allowedKinds={hasPeer ? primaryKindSet : undefined}
          />

          {/* Peer canvas (split-screen) */}
          {hasPeer && (
            <>
              <div className="fxeditor-divider" />
              <EffectCanvasPane
                paneId="peer"
                nodes={peerNodes}
                setNodes={setPeerNodes}
                edges={peerEdges}
                setEdges={setPeerEdges}
                selectedNodeId={activePane === 'peer' ? peerSelectedNodeId : null}
                onSelectNode={(id) => {
                  setPeerSelectedNodeId(id)
                  setSelectedNodeId(null)
                  setActivePane('peer')
                }}
                pan={peerPan}
                setPan={setPeerPan}
                isNodeLocked={isNodeLocked}
                onFocus={() => { setSelectedNodeId(null); setActivePane('peer') }}
                label={peerEffect!.label}
                labelColor="#f472b6"
                canvasRef={peerCanvasRef}
                onCrossDraftStart={(fromId, fromPort) => setCrossDraft({ sourcePane: 'peer', fromId, fromPort, clientX: 0, clientY: 0 })}
                onCrossDraftMove={(cx, cy) => setCrossDraft(prev => prev ? { ...prev, clientX: cx, clientY: cy } : null)}
                onCrossDraftEnd={() => { const d = crossDraftRef.current; if (d) { resolveCrossDrop(d); setCrossDraft(null) } }}
                incomingCrossDraft={crossDraft && crossDraft.sourcePane === 'primary' ? crossDraft : null}
                allowedKinds={peerKindSet}
              />
            </>
          )}

          {/* Properties panel */}
          <div className="fxeditor-props">

          {/* Cross-pane overlay: persistent cross-edge cables + draft cable, viewport coords */}
          {hasPeer && (
            <svg style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 10000 }}>
              {/* Persistent cross-edge cables */}
              {(() => {
                const allCross: { edge: EffectGraphEdge; sourcePane: 'primary' | 'peer' }[] = [
                  ...edges.filter(e => !!e.crossNodeId).map(e => ({ edge: e, sourcePane: 'primary' as const })),
                  ...peerEdges.filter(e => !!e.crossNodeId).map(e => ({ edge: e, sourcePane: 'peer' as const })),
                ]
                return allCross.map(({ edge, sourcePane }) => {
                  const srcRef = sourcePane === 'primary' ? primaryCanvasRef : peerCanvasRef
                  const srcPan = sourcePane === 'primary' ? pan : peerPan
                  const srcNodes = sourcePane === 'primary' ? nodes : peerNodes
                  const tgtRef = sourcePane === 'primary' ? peerCanvasRef : primaryCanvasRef
                  const tgtPan = sourcePane === 'primary' ? peerPan : pan
                  const tgtNodes = sourcePane === 'primary' ? peerNodes : nodes
                  const fromNode = srcNodes.find(n => n.id === edge.from)
                  const toNode = tgtNodes.find(n => n.id === edge.to)
                  const srcRect = srcRef.current?.getBoundingClientRect()
                  const tgtRect = tgtRef.current?.getBoundingClientRect()
                  if (!fromNode || !toNode || !srcRect || !tgtRect) return null
                  const fp = portPos(fromNode, 'out', edge.fromPort)
                  const tp = portPos(toNode, 'in', edge.toPort)
                  const sx = srcRect.left + srcPan.x + fp.x
                  const sy = srcRect.top + srcPan.y + fp.y
                  const tx = tgtRect.left + tgtPan.x + tp.x
                  const ty = tgtRect.top + tgtPan.y + tp.y
                  const midY = (sy + ty) / 2
                  const key = `cross-${sourcePane}-${edge.from}->${edge.to}:${edge.fromPort ?? ''}:${edge.toPort ?? ''}`
                  const deleteCross = () => {
                    const setSourceEdges = sourcePane === 'primary' ? setEdges : setPeerEdges
                    setSourceEdges(prev => prev.filter(e => !(e.from === edge.from && e.to === edge.to && e.crossNodeId === edge.crossNodeId)))
                  }
                  return (
                    <g key={key} style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={deleteCross}>
                      <path
                        d={`M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`}
                        stroke="#c084fc" strokeWidth={2} fill="none" strokeDasharray="6,4"
                      />
                      <path
                        d={`M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`}
                        stroke="transparent" strokeWidth={12} fill="none"
                      />
                    </g>
                  )
                })
              })()}
              {/* Draft cable while dragging across panes */}
              {crossDraft && crossDraft.clientX > 0 && (() => {
                const sourceRef = crossDraft.sourcePane === 'primary' ? primaryCanvasRef : peerCanvasRef
                const sourcePan = crossDraft.sourcePane === 'primary' ? pan : peerPan
                const sourceNodes = crossDraft.sourcePane === 'primary' ? nodes : peerNodes
                const sourceNode = sourceNodes.find(n => n.id === crossDraft.fromId)
                const rect = sourceRef.current?.getBoundingClientRect()
                if (!sourceNode || !rect) return null
                const fp = portPos(sourceNode, 'out', crossDraft.fromPort)
                const sx = rect.left + sourcePan.x + fp.x
                const sy = rect.top + sourcePan.y + fp.y
                const cx = crossDraft.clientX
                const cy = crossDraft.clientY
                const midY = (sy + cy) / 2
                return (
                  <g>
                    <path
                      d={`M${sx},${sy} C${sx},${midY} ${cx},${midY} ${cx},${cy}`}
                      stroke="#c084fc" strokeWidth={2} fill="none" strokeDasharray="6,4"
                    />
                    <circle cx={cx} cy={cy} r={4} fill="#c084fc" opacity={0.7} />
                  </g>
                )
              })()}
            </svg>
          )}
            <FlowNodeConfigPanel
              selectedNode={selectedNode}
              updateNodeConfig={updateNodeConfig}
              setNodes={setCurNodes}
              selectedNodeId={curSelectedId}
              isNodeLocked={isNodeLocked}
              deleteSelected={deleteSelected}
              addableKinds={addableKinds}
              addNode={addNode}
              hostContext={curHostContext}
              hostNodeId={curHostContext.hostNodeId}
              kindLabels={kindLabels}
              kindColors={kindColors}
              onSyncPreviewFacades={onSyncPreviewFacades ? (graphNodeId, items) => onSyncPreviewFacades(curHostContext.hostNodeId, graphNodeId, items) : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
