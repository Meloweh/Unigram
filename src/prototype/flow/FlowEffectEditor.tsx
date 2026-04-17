import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowEffect, FlowEffectKind, EffectGraphNode, EffectGraphEdge, EffectPortId, CosmeticType } from '../model/sampleModels'
import { FlowNodeConfigPanel } from './FlowNodeConfigPanel'

// ---- Host context passed from viewport ----

export interface EffectEditorHostContext {
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
    case 'record': return { captureMode: 'tab', hideCursor: true, recordingWidth: 1920, recordingHeight: 1080, videoBitrateMbps: 32, codec: 'vp9', fps: 30 }
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

// ---- Component ----

export function FlowEffectEditor({
  effect,
  hostContext,
  onSave,
  onClose,
}: {
  effect: FlowEffect
  hostContext: EffectEditorHostContext
  onSave: (updated: FlowEffect) => void
  onClose: () => void
}) {
  // Build the addable kinds based on host context
  const isContentNode = hostContext.mediaType === 'markdown' || hostContext.mediaType === 'math'
  const addableKinds: FlowEffectKind[] = [
    'wait', 'move', 'color', 'spawn', 'spawn-circular', 'emerge', 'dismiss', 'jitter', 'float', 'scale', 'camera', 'break', 'record', 'text-format', 'text-generator', 'repeater',
    ...(isContentNode ? ['expand' as const, 'collapse' as const] : []),
    ...(hostContext.hasChildModel ? ['handoff-rmm' as const] : []),
    ...(hostContext.isInsideChildModel ? ['return-rmm' as const] : []),
    ...(hostContext.mpdIds.length > 1 ? ['handoff-mpd' as const] : []),
    ...(hostContext.cosmeticType === 'thinking-cloud' ? ['cloud-levitate' as const] : []),
    ...(hostContext.cosmeticType === 'chat-bubble' ? ['bubble-levitate' as const] : []),
  ]

  // Local working copy of the graph — ensure entry node exists
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

  // Dragging state
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  // Edge drafting
  const [edgeDraft, setEdgeDraft] = useState<{ fromId: string; fromPort?: EffectPortId; mx: number; my: number } | null>(null)
  // Panning
  const panRef = useRef<{ startX: number; startY: number; origPanX: number; origPanY: number } | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  // Graph coordinate from mouse event
  const toGraph = useCallback((e: React.MouseEvent | MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left - pan.x, y: e.clientY - rect.top - pan.y }
  }, [pan])

  // ---- Node dragging ----
  const onNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelectedNodeId(nodeId)
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y }
  }, [nodes])

  // ---- Edge creation (drag from output port) ----
  const onPortPointerDown = useCallback((e: React.PointerEvent, nodeId: string, port?: EffectPortId) => {
    e.stopPropagation()
    e.preventDefault()
    const gp = toGraph(e)
    setEdgeDraft({ fromId: nodeId, fromPort: port, mx: gp.x, my: gp.y })
  }, [toGraph])

  // ---- Canvas pointer events ----
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) return
    if (e.button === 0) {
      setSelectedNodeId(null)
      // Start panning
      panRef.current = { startX: e.clientX, startY: e.clientY, origPanX: pan.x, origPanY: pan.y }
    }
  }, [pan])

  const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    // Node dragging takes priority
    if (dragRef.current) {
      const { nodeId, startX, startY, origX, origY } = dragRef.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const nx = snapToGridVal(origX + dx)
      const ny = snapToGridVal(origY + dy)
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, x: nx, y: ny } : n))
      return
    }
    if (edgeDraft) {
      const gp = toGraph(e)
      setEdgeDraft(prev => prev ? { ...prev, mx: gp.x, my: gp.y } : null)
      return
    }
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX
      const dy = e.clientY - panRef.current.startY
      setPan({ x: panRef.current.origPanX + dx, y: panRef.current.origPanY + dy })
    }
  }, [edgeDraft, toGraph])

  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      dragRef.current = null
      return
    }
    if (edgeDraft) {
      // Check if we're over an input port
      const gp = toGraph(e)
      // Build candidate ports: for repeater nodes, check both default and circuit input ports
      let bestTarget: { node: EffectGraphNode; port?: EffectPortId; dist: number } | null = null
      for (const n of nodes) {
        if (n.kind === 'entry') continue // entry has no input port
        // Allow self-loop only for repeater circuit edges
        if (n.id === edgeDraft.fromId && n.kind !== 'repeater') continue
        if (n.kind === 'repeater') {
          for (const p of ['default', 'circuit'] as EffectPortId[]) {
            // For self-loops, only allow circuit-out → circuit-in
            if (n.id === edgeDraft.fromId && (edgeDraft.fromPort !== 'circuit' || p !== 'circuit')) continue
            const ip = portPos(n, 'in', p)
            const dist = Math.hypot(gp.x - ip.x, gp.y - ip.y)
            if (dist < PORT_R * 3 && (!bestTarget || dist < bestTarget.dist)) {
              bestTarget = { node: n, port: p, dist }
            }
          }
        } else {
          if (n.id === edgeDraft.fromId) continue
          const ip = portPos(n, 'in')
          const dist = Math.hypot(gp.x - ip.x, gp.y - ip.y)
          if (dist < PORT_R * 3 && (!bestTarget || dist < bestTarget.dist)) {
            bestTarget = { node: n, dist }
          }
        }
      }
      if (bestTarget) {
        const { node: target, port: toPort } = bestTarget
        // Don't allow duplicate edges (same from/to/ports)
        const exists = edges.some(ed =>
          ed.from === edgeDraft.fromId && ed.to === target.id &&
          (ed.fromPort ?? undefined) === edgeDraft.fromPort &&
          (ed.toPort ?? undefined) === toPort
        )
        if (!exists) {
          const newEdge: EffectGraphEdge = { from: edgeDraft.fromId, to: target.id }
          if (edgeDraft.fromPort) newEdge.fromPort = edgeDraft.fromPort
          if (toPort) newEdge.toPort = toPort
          setEdges(prev => [...prev, newEdge])
        }
      }
      setEdgeDraft(null)
      return
    }
    panRef.current = null
  }, [edgeDraft, toGraph, nodes, edges])

  // ---- Add node ----
  const addNodeAt = useCallback((kind: FlowEffectKind, gx: number, gy: number) => {
    const node: EffectGraphNode = {
      id: uid(),
      kind,
      label: kindLabels[kind],
      x: snapToGridVal(gx - NODE_W / 2),
      y: snapToGridVal(gy - NODE_H / 2),
      config: defaultConfig(kind),
    }
    setNodes(prev => [...prev, node])
    setSelectedNodeId(node.id)
  }, [])

  const addNode = useCallback((kind: FlowEffectKind) => {
    // Place at center of visible canvas area
    const rect = canvasRef.current?.getBoundingClientRect()
    const cx = rect ? (rect.width / 2 - pan.x) : 200
    const cy = rect ? (rect.height / 2 - pan.y) : 200
    addNodeAt(kind, cx, cy)
  }, [pan, addNodeAt])

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const kind = e.dataTransfer.getData('application/fxnode-kind') as FlowEffectKind
    if (!kind) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const gx = e.clientX - rect.left - pan.x
    const gy = e.clientY - rect.top - pan.y
    addNodeAt(kind, gx, gy)
  }, [pan, addNodeAt])

  // ---- Check if a node is undeletable ----
  const isNodeLocked = useCallback((node: EffectGraphNode) => {
    if (node.kind === 'entry') return true
    if (effect.locked && node.kind === 'play-media') return true
    return false
  }, [effect.locked])

  // ---- Delete selected node ----
  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return
    const node = nodes.find(n => n.id === selectedNodeId)
    if (!node || isNodeLocked(node)) return
    setNodes(prev => prev.filter(n => n.id !== selectedNodeId))
    setEdges(prev => prev.filter(e => e.from !== selectedNodeId && e.to !== selectedNodeId))
    setSelectedNodeId(null)
  }, [selectedNodeId, nodes, isNodeLocked])

  // ---- Delete edge ----
  const deleteEdge = useCallback((from: string, to: string, fromPort?: EffectPortId, toPort?: EffectPortId) => {
    setEdges(prev => prev.filter(e => !(e.from === from && e.to === to && (e.fromPort ?? undefined) === fromPort && (e.toPort ?? undefined) === toPort)))
  }, [])

  // ---- Keyboard (capture and stop propagation so viewport doesn't react) ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete nodes when typing in an input
        if ((e.target as HTMLElement).tagName === 'INPUT') return
        deleteSelected()
      }
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [deleteSelected, onClose])

  // ---- Properties panel for selected node ----
  const selectedNode = nodes.find(n => n.id === selectedNodeId)

  const updateNodeConfig = useCallback((key: string, value: unknown) => {
    if (!selectedNodeId) return
    setNodes(prev => prev.map(n =>
      n.id === selectedNodeId
        ? { ...n, config: { ...n.config, [key]: value } }
        : n
    ))
  }, [selectedNodeId])

  // ---- Save ----
  const handleSave = useCallback(() => {
    onSave({ ...effect, graph: { nodes, edges } })
  }, [effect, nodes, edges, onSave])



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
          <span className="fxeditor-title">Effect Graph: {effect.label}</span>
          <div className="fxeditor-header-actions">
            <button type="button" className="fxeditor-save-btn" onClick={handleSave}>Save</button>
            <button type="button" className="fxeditor-close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="fxeditor-body">
          {/* Canvas */}
          <div
            className="fxeditor-canvas"
            ref={canvasRef}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
          >
            {/* Grid dots hint */}
            <svg className="fxeditor-grid" width="100%" height="100%">
              <defs>
                <pattern id="fxgrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse"
                  x={pan.x % GRID} y={pan.y % GRID}>
                  <circle cx={GRID / 2} cy={GRID / 2} r="1" fill="rgba(255,255,255,0.08)" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#fxgrid)" />
            </svg>

            {/* Panned layer */}
            <div className="fxeditor-pan" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
              {/* Edges */}
              <svg className="fxeditor-edges" style={{ overflow: 'visible', position: 'absolute', top: 0, left: 0, width: 1, height: 1 }}>
                <defs>
                  <marker id="fxarrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
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
                        stroke="#94a3b8" strokeWidth={2} fill="none" markerEnd="url(#fxarrow)"
                      />
                      {/* Invisible wider hit area */}
                      <path
                        d={`M${fp.x},${fp.y} C${fp.x},${midY} ${tp.x},${midY} ${tp.x},${tp.y}`}
                        stroke="transparent" strokeWidth={12} fill="none" style={{ cursor: 'pointer' }}
                      />
                    </g>
                  )
                })}
                {/* Draft edge line */}
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
              </svg>

              {/* Nodes */}
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
                    {/* Input ports */}
                    {isRepeater ? (
                      <>
                        <div
                          className="fxeditor-port in port-default"
                          style={{ background: color, left: '25%' }}
                        />
                        <div
                          className="fxeditor-port in port-circuit"
                          style={{ background: color, left: '75%' }}
                        />
                      </>
                    ) : !isEntry ? (
                      <div
                        className="fxeditor-port in"
                        style={{ background: color }}
                      />
                    ) : null}
                    {/* Node content */}
                    <div className="fxeditor-node-kind" style={{ color }}>{kindLabels[node.kind]}</div>
                    <div className="fxeditor-node-label">{node.label}</div>
                    {locked && !isEntry && <div className="fxeditor-lock-badge">🔒</div>}
                    {/* Output ports */}
                    {isRepeater ? (
                      <>
                        <div
                          className="fxeditor-port out port-default"
                          style={{ background: color, left: '25%' }}
                          onPointerDown={(e) => onPortPointerDown(e, node.id, 'default')}
                        />
                        <div
                          className="fxeditor-port out port-circuit"
                          style={{ background: color, left: '75%' }}
                          onPointerDown={(e) => onPortPointerDown(e, node.id, 'circuit')}
                        />
                      </>
                    ) : (
                      <div
                        className="fxeditor-port out"
                        style={{ background: color }}
                        onPointerDown={(e) => onPortPointerDown(e, node.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>

          </div>

          {/* Properties panel */}
          <div className="fxeditor-props">
            <FlowNodeConfigPanel
              selectedNode={selectedNode}
              updateNodeConfig={updateNodeConfig}
              setNodes={setNodes}
              selectedNodeId={selectedNodeId}
              isNodeLocked={isNodeLocked}
              deleteSelected={deleteSelected}
              addableKinds={addableKinds}
              addNode={addNode}
              hostContext={hostContext}
              kindLabels={kindLabels}
              kindColors={kindColors}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
