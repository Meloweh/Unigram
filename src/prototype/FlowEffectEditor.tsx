import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowEffect, FlowEffectKind, EffectGraphNode, EffectGraphEdge } from './sampleModels'

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

// ---- Constants ----

const NODE_W = 160
const NODE_H = 56
const PORT_R = 6
const GRID = 20

const kindLabels: Record<FlowEffectKind, string> = {
  'entry': 'Signal In',
  'wait': 'Wait',
  'move': 'Move',
  'color': 'Color',
  'spawn': 'Spawn',
  'play-media': 'Play media',
  'handoff-rmm': 'Handoff to RMM',
  'return-rmm': 'Return from RMM',
  'handoff-mpd': 'Handoff to MPD',
}

const kindColors: Record<FlowEffectKind, string> = {
  'entry': '#38bdf8',
  'wait': '#6366f1',
  'move': '#10b981',
  'color': '#f59e0b',
  'spawn': '#ec4899',
  'play-media': '#f97316',
  'handoff-rmm': '#a78bfa',
  'return-rmm': '#c084fc',
  'handoff-mpd': '#2dd4bf',
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
    case 'move': return { waypoints: [{ dx: 0, dy: 0, durationMs: 500 }], roundtrip: false }
    case 'color': return { color: '#f59e0b', durationMs: 300, permanent: false }
    case 'spawn': return { spawnItems: [] }
    case 'play-media': return {}
    case 'handoff-rmm': return {}
    case 'return-rmm': return {}
    case 'handoff-mpd': return { targetMpdId: '' }
  }
}

// ---- Helpers ----

function snapToGridVal(v: number) {
  return Math.round(v / GRID) * GRID
}

function portPos(node: EffectGraphNode, side: 'in' | 'out') {
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
  const addableKinds: FlowEffectKind[] = [
    'wait', 'move', 'color', 'spawn', 'play-media',
    ...(hostContext.hasChildModel ? ['handoff-rmm' as const] : []),
    ...(hostContext.isInsideChildModel ? ['return-rmm' as const] : []),
    ...(hostContext.mpdIds.length > 1 ? ['handoff-mpd' as const] : []),
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; graphX: number; graphY: number } | null>(null)

  // Dragging state
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null)
  // Edge drafting
  const [edgeDraft, setEdgeDraft] = useState<{ fromId: string; mx: number; my: number } | null>(null)
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
    setContextMenu(null)
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y }
  }, [nodes])

  // ---- Edge creation (drag from output port) ----
  const onPortPointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation()
    e.preventDefault()
    const gp = toGraph(e)
    setEdgeDraft({ fromId: nodeId, mx: gp.x, my: gp.y })
  }, [toGraph])

  // ---- Canvas pointer events ----
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) return // context menu handled separately
    if (e.button === 0) {
      setSelectedNodeId(null)
      setContextMenu(null)
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
      const target = nodes.find(n => {
        if (n.id === edgeDraft.fromId) return false
        if (n.kind === 'entry') return false // entry has no input port
        const ip = portPos(n, 'in')
        return Math.hypot(gp.x - ip.x, gp.y - ip.y) < PORT_R * 3
      })
      if (target) {
        // Don't allow duplicate edges
        const exists = edges.some(ed => ed.from === edgeDraft.fromId && ed.to === target.id)
        if (!exists) {
          setEdges(prev => [...prev, { from: edgeDraft.fromId, to: target.id }])
        }
      }
      setEdgeDraft(null)
      return
    }
    panRef.current = null
  }, [edgeDraft, toGraph, nodes, edges])

  // ---- Context menu (add nodes) ----
  const onCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const gp = toGraph(e)
    setContextMenu({ x: e.clientX, y: e.clientY, graphX: gp.x, graphY: gp.y })
  }, [toGraph])

  const addNode = useCallback((kind: FlowEffectKind, gx: number, gy: number) => {
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
    setContextMenu(null)
  }, [])

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
  const deleteEdge = useCallback((from: string, to: string) => {
    setEdges(prev => prev.filter(e => !(e.from === from && e.to === to)))
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

  // ---- Dismiss context menu on click elsewhere ----
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    window.addEventListener('click', dismiss, { once: true })
    return () => window.removeEventListener('click', dismiss)
  }, [contextMenu])

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
            onContextMenu={onCanvasContextMenu}
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
                  const fp = portPos(fromNode, 'out')
                  const tp = portPos(toNode, 'in')
                  const midY = (fp.y + tp.y) / 2
                  return (
                    <g key={`${edge.from}->${edge.to}`}
                      className="fxeditor-edge-g"
                      onClick={(e) => { e.stopPropagation(); deleteEdge(edge.from, edge.to) }}>
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
                  const fp = portPos(fromNode, 'out')
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
                    {/* Input port (top) — not on entry nodes */}
                    {!isEntry && (
                      <div
                        className="fxeditor-port in"
                        style={{ background: color }}
                      />
                    )}
                    {/* Node content */}
                    <div className="fxeditor-node-kind" style={{ color }}>{kindLabels[node.kind]}</div>
                    <div className="fxeditor-node-label">{node.label}</div>
                    {locked && !isEntry && <div className="fxeditor-lock-badge">🔒</div>}
                    {/* Output port (bottom) */}
                    <div
                      className="fxeditor-port out"
                      style={{ background: color }}
                      onPointerDown={(e) => onPortPointerDown(e, node.id)}
                    />
                  </div>
                )
              })}
            </div>

            {/* Context menu */}
            {contextMenu && (
              <div className="fxeditor-context-menu"
                style={{ left: contextMenu.x - (canvasRef.current?.getBoundingClientRect().left ?? 0), top: contextMenu.y - (canvasRef.current?.getBoundingClientRect().top ?? 0) }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="fxeditor-context-title">Add Node</div>
                {addableKinds.map(kind => (
                  <button key={kind} type="button" className="fxeditor-context-item"
                    onClick={() => addNode(kind, contextMenu.graphX, contextMenu.graphY)}>
                    <span className="fxeditor-context-dot" style={{ background: kindColors[kind] }} />
                    {kindLabels[kind]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Properties panel */}
          <div className="fxeditor-props">
            {selectedNode ? (
              <>
                <div className="fxeditor-props-title">
                  <span className="fxeditor-props-dot" style={{ background: kindColors[selectedNode.kind] }} />
                  {kindLabels[selectedNode.kind]}
                </div>
                <label className="fxeditor-field">
                  <span>Label</span>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => setNodes(prev => prev.map(n =>
                      n.id === selectedNodeId ? { ...n, label: e.target.value } : n
                    ))}
                  />
                </label>
                {/* ---- Entry node ---- */}
                {selectedNode.kind === 'entry' && (
                  <>
                    <div className="fxeditor-field-hint">
                      Flow signal arrives here. Connect to effect nodes below.
                    </div>
                    <label className="fxeditor-checkbox">
                      <input
                        type="checkbox"
                        checked={!!selectedNode.config.triggeredByRmmParent}
                        onChange={(e) => updateNodeConfig('triggeredByRmmParent', e.target.checked)}
                      />
                      <span>Triggered by RMM Parent</span>
                    </label>
                  </>
                )}
                {/* ---- Wait ---- */}
                {selectedNode.kind === 'wait' && (
                  <label className="fxeditor-field">
                    <span>Duration (ms)</span>
                    <input type="number" min={0} step={50}
                      value={(selectedNode.config.durationMs as number) ?? 500}
                      onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
                  </label>
                )}
                {/* ---- Move ---- */}
                {selectedNode.kind === 'move' && (() => {
                  const waypoints: MoveWaypoint[] = (selectedNode.config.waypoints as MoveWaypoint[] | undefined) ?? []
                  const updateWaypoints = (items: MoveWaypoint[]) => updateNodeConfig('waypoints', items)
                  return (
                    <div className="fxeditor-spawn-section">
                      <div className="fxeditor-field-hint">
                        Define waypoints the node will move through sequentially.
                      </div>
                      {waypoints.map((wp, idx) => (
                        <div key={idx} className="fxeditor-spawn-item">
                          <div className="fxeditor-spawn-item-header">
                            <span className="fxeditor-spawn-item-num">#{idx + 1}</span>
                            {waypoints.length > 1 && (
                              <button type="button" className="fxeditor-spawn-remove"
                                onClick={() => updateWaypoints(waypoints.filter((_, i) => i !== idx))}>×</button>
                            )}
                          </div>
                          <div className="fxeditor-field-row">
                            <label className="fxeditor-field" style={{ flex: 1 }}>
                              <span>ΔX (%)</span>
                              <input type="number" step={1} value={wp.dx}
                                onChange={(e) => {
                                  const next = [...waypoints]
                                  next[idx] = { ...wp, dx: Number(e.target.value) }
                                  updateWaypoints(next)
                                }} />
                            </label>
                            <label className="fxeditor-field" style={{ flex: 1 }}>
                              <span>ΔY (%)</span>
                              <input type="number" step={1} value={wp.dy}
                                onChange={(e) => {
                                  const next = [...waypoints]
                                  next[idx] = { ...wp, dy: Number(e.target.value) }
                                  updateWaypoints(next)
                                }} />
                            </label>
                          </div>
                          <label className="fxeditor-field">
                            <span>Duration (ms)</span>
                            <input type="number" min={0} step={50} value={wp.durationMs}
                              onChange={(e) => {
                                const next = [...waypoints]
                                next[idx] = { ...wp, durationMs: Number(e.target.value) }
                                updateWaypoints(next)
                              }} />
                          </label>
                        </div>
                      ))}
                      <button type="button" className="fxeditor-spawn-add"
                        onClick={() => updateWaypoints([...waypoints, { dx: 0, dy: 0, durationMs: 500 }])}>
                        + Add waypoint
                      </button>
                      <label className="fxeditor-checkbox" style={{ marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked={!!selectedNode.config.roundtrip}
                          onChange={(e) => updateNodeConfig('roundtrip', e.target.checked)}
                        />
                        <span>Roundtrip (return to start)</span>
                      </label>
                    </div>
                  )
                })()}
                {/* ---- Color ---- */}
                {selectedNode.kind === 'color' && (
                  <>
                    <label className="fxeditor-field">
                      <span>Color</span>
                      <input type="color"
                        value={(selectedNode.config.color as string) ?? '#f59e0b'}
                        onChange={(e) => updateNodeConfig('color', e.target.value)} />
                    </label>
                    <label className="fxeditor-checkbox">
                      <input
                        type="checkbox"
                        checked={!!selectedNode.config.permanent}
                        onChange={(e) => updateNodeConfig('permanent', e.target.checked)}
                      />
                      <span>Permanent</span>
                    </label>
                    {!selectedNode.config.permanent && (
                      <label className="fxeditor-field">
                        <span>Duration (ms)</span>
                        <input type="number" min={0} step={50}
                          value={(selectedNode.config.durationMs as number) ?? 300}
                          onChange={(e) => updateNodeConfig('durationMs', Number(e.target.value))} />
                      </label>
                    )}
                  </>
                )}
                {/* ---- Play media ---- */}
                {selectedNode.kind === 'play-media' && (
                  <div className="fxeditor-field-hint">
                    Triggers media playback on the host node.
                  </div>
                )}
                {/* ---- Spawn ---- */}
                {selectedNode.kind === 'spawn' && (() => {
                  const spawnItems: SpawnItem[] = (selectedNode.config.spawnItems as SpawnItem[] | undefined) ?? []
                  const updateSpawnItems = (items: SpawnItem[]) => updateNodeConfig('spawnItems', items)
                  return (
                    <div className="fxeditor-spawn-section">
                      <div className="fxeditor-field-hint">
                        Define nodes to spawn when this effect runs.
                      </div>
                      {spawnItems.map((item, idx) => (
                        <div key={idx} className="fxeditor-spawn-item">
                          <div className="fxeditor-spawn-item-header">
                            <span className="fxeditor-spawn-item-num">#{idx + 1}</span>
                            <button type="button" className="fxeditor-spawn-remove"
                              onClick={() => updateSpawnItems(spawnItems.filter((_, i) => i !== idx))}>×</button>
                          </div>
                          <label className="fxeditor-field">
                            <span>Label</span>
                            <input type="text" value={item.label}
                              onChange={(e) => {
                                const next = [...spawnItems]
                                next[idx] = { ...item, label: e.target.value }
                                updateSpawnItems(next)
                              }} />
                          </label>
                          <div className="fxeditor-field-row">
                            <label className="fxeditor-field" style={{ flex: 1 }}>
                              <span>ΔX (%)</span>
                              <input type="number" step={1} value={item.offsetX}
                                onChange={(e) => {
                                  const next = [...spawnItems]
                                  next[idx] = { ...item, offsetX: Number(e.target.value) }
                                  updateSpawnItems(next)
                                }} />
                            </label>
                            <label className="fxeditor-field" style={{ flex: 1 }}>
                              <span>ΔY (%)</span>
                              <input type="number" step={1} value={item.offsetY}
                                onChange={(e) => {
                                  const next = [...spawnItems]
                                  next[idx] = { ...item, offsetY: Number(e.target.value) }
                                  updateSpawnItems(next)
                                }} />
                            </label>
                          </div>
                          <label className="fxeditor-field">
                            <span>Animation</span>
                            <select value={item.animation}
                              onChange={(e) => {
                                const next = [...spawnItems]
                                next[idx] = { ...item, animation: e.target.value as SpawnItem['animation'] }
                                updateSpawnItems(next)
                              }}>
                              <option value="emerge">Emerge from source</option>
                              <option value="zip-in">Zip-in</option>
                            </select>
                          </label>
                          <label className="fxeditor-field">
                            <span>Connection</span>
                            <select value={item.connectionType}
                              onChange={(e) => {
                                const next = [...spawnItems]
                                next[idx] = { ...item, connectionType: e.target.value as SpawnItem['connectionType'] }
                                updateSpawnItems(next)
                              }}>
                              <option value="none">No connection</option>
                              <option value="default">Default connection</option>
                              <option value="flow">Flow connection</option>
                            </select>
                          </label>
                        </div>
                      ))}
                      <button type="button" className="fxeditor-spawn-add"
                        onClick={() => updateSpawnItems([...spawnItems, {
                          label: `Node ${spawnItems.length + 1}`,
                          offsetX: 10, offsetY: 10,
                          animation: 'emerge',
                          connectionType: 'none',
                        }])}>
                        + Add spawn item
                      </button>
                    </div>
                  )
                })()}
                {/* ---- Handoff to RMM ---- */}
                {selectedNode.kind === 'handoff-rmm' && (
                  <div className="fxeditor-field-hint">
                    Zooms into this node's RMM child dimension and resumes the effect graph entry that has "Triggered by RMM Parent" checked.
                  </div>
                )}
                {/* ---- Return from RMM ---- */}
                {selectedNode.kind === 'return-rmm' && (
                  <div className="fxeditor-field-hint">
                    Zooms out from this RMM child dimension and resumes the parent's flow.
                  </div>
                )}
                {/* ---- Handoff to MPD ---- */}
                {selectedNode.kind === 'handoff-mpd' && (
                  <>
                    <div className="fxeditor-field-hint">
                      Switches to a target MPD. The twin node in the target dimension will be triggered.
                    </div>
                    <label className="fxeditor-field">
                      <span>Target MPD</span>
                      <select
                        value={(selectedNode.config.targetMpdId as string) ?? ''}
                        onChange={(e) => updateNodeConfig('targetMpdId', e.target.value)}
                      >
                        <option value="" disabled>Select dimension…</option>
                        {hostContext.mpdIds.map(id => (
                          <option key={id} value={id}>{hostContext.mpdLabels[id] ?? id}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {/* Delete button */}
                {!isNodeLocked(selectedNode) && (
                  <button type="button" className="fxeditor-delete-btn" onClick={deleteSelected}>
                    Delete Node
                  </button>
                )}
              </>
            ) : (
              <div className="fxeditor-props-empty">
                <p>Select a node to edit its properties.</p>
                <p style={{ opacity: 0.6, fontSize: '0.8rem' }}>Right-click on the canvas to add nodes.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
