import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CAMERA_SCALE_FINAL } from './hybridZoom'
import { type Model, type ModelNode } from './sampleModels'
import { UnzipPopup } from './UnzipPopup'
import { GRID_SNAP, snapToGrid, useHybridZoomStore, type UnzipPopupState } from './useHybridZoomStore'
import { MpdDial } from './MpdDial'

/** Drives unzip open/close animation (0→1 open, 1→0 close) */
function useUnzipAnim(popupKey: string | null) {
  const [progress, setProgress] = useState(0)
  const currentRef = useRef(0)
  const lastKeyRef = useRef<string | null>(null)

  if (popupKey) lastKeyRef.current = popupKey

  useEffect(() => {
    if (popupKey) {
      currentRef.current = 0
      setProgress(0)
      const startTime = performance.now()
      let rafId: number
      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 400, 1)
        const eased = 1 - (1 - t) ** 3
        currentRef.current = eased
        setProgress(eased)
        if (t < 1) rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    } else {
      const from = currentRef.current
      if (from < 0.001) return
      const startTime = performance.now()
      let rafId: number
      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 250, 1)
        const eased = 1 - (1 - t) ** 3
        const v = from * (1 - eased)
        currentRef.current = v
        setProgress(v)
        if (t < 1) {
          rafId = requestAnimationFrame(tick)
        } else {
          lastKeyRef.current = null
          currentRef.current = 0
          setProgress(0)
        }
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    }
  }, [popupKey])

  const displayKey = (popupKey || progress > 0.001) ? (popupKey ?? lastKeyRef.current) : null
  return { progress, displayKey }
}

/** Minimum base dimensions fallback before label measured */
const NODE_MIN_W = 80
const NODE_MIN_H = 40

export function PrototypeViewport() {
  const [debugOpen, setDebugOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 1400, h: 900 })
  const {
    stack,
    currentFrame,
    isDragging,
    isPaused,
    unzipPopup,
    selectNode,
    clearSelection,
    zoomIn,
    zoomOut,
    pushModel,
    openUnzip,
    closeUnzip,
    pause,
    beginDrag,
    endDrag,
    panBy,
    getModel: storeGetModel,
    moveNode,
    beginMoveNode,
    addNode,
    updateNodeLabel,
    removeNode,
    addConnection,
    undo,
    redo,
    undoStacks,
    redoStacks,
    switchFrameMpd,
  } = useHybridZoomStore()

  const frame = currentFrame()
  const model = storeGetModel(frame.modelId)!
  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setVpSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Unzip open/close animation
  const { progress: unzipAnimProgress, displayKey: unzipDisplayKey } = useUnzipAnim(
    unzipPopup?.connectionKey ?? null,
  )
  const lastUnzipRef = useRef<UnzipPopupState | null>(null)
  if (unzipPopup) lastUnzipRef.current = unzipPopup
  const activeUnzipPopup = unzipDisplayKey ? (unzipPopup ?? lastUnzipRef.current) : null

  // Track popup measured size for ConnectionLine bow computation
  const [popupSize, setPopupSize] = useState<{ w: number; h: number } | null>(null)
  const handlePopupSizeChange = useMemo(() => (w: number, h: number) => setPopupSize({ w, h }), [])

  const p = frame.snapshot.nodeInflation // 0→1
  const isChild = frame.snapshot.handoffMode === 'child'

  // Find the selected node and its child model
  const selectedNode = model.nodes.find((n) => n.id === frame.selectedNodeId)
  const childModel = selectedNode?.childModelId ? storeGetModel(selectedNode.childModelId) : undefined

  // MPD options: derived from the current frame's mpdIds (inherited from entry node)
  const mpdOptions = useMemo(() => {
    if (!frame.mpdIds || frame.mpdIds.length <= 1) return null
    return frame.mpdIds.map((id) => {
      const m = storeGetModel(id)
      return { id, label: m?.label ?? id }
    })
  }, [frame.mpdIds, storeGetModel])
  const mpdActiveIndex = mpdOptions
    ? Math.max(0, frame.mpdIds!.indexOf(frame.modelId))
    : 0

  const sceneStyle = useMemo(() => {
    // Auto-center: smoothly pan the scene so the selected node tracks toward viewport center.
    // At nodeProgress=0, no centering. At nodeProgress=1, node is centered.
    // Formula: centering = nodeProgress × (0.5 − node.x/100) × vpSize × cameraScale
    let cx = 0
    let cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * frame.snapshot.cameraScale
      cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * frame.snapshot.cameraScale
    }
    return {
      transform: `translate(${cx + frame.panOffset.x}px, ${cy + frame.panOffset.y}px) scale(${frame.snapshot.cameraScale})`,
    }
  }, [selectedNode, frame.snapshot.nodeProgress, frame.snapshot.cameraScale, frame.panOffset.x, frame.panOffset.y, vpSize.w, vpSize.h])

  // At handoff, if the selected node has a child model, push into it
  useEffect(() => {
    if (isChild && selectedNode?.childModelId) {
      pushModel(selectedNode.childModelId, selectedNode.id)
    }
  }, [isChild, selectedNode?.childModelId, selectedNode?.id, pushModel])

  // Compute the centering offset currently applied for the selected node
  // so we can bake it into panOffset when switching nodes (prevents visual jump)
  const handleSelectNode = (nodeId: string) => {
    if (selectedNode && frame.snapshot.nodeProgress > 0) {
      const np = frame.snapshot.nodeProgress
      const cs = frame.snapshot.cameraScale
      const residual = {
        x: np * (0.5 - selectedNode.x / 100) * vpSize.w * cs,
        y: np * (0.5 - selectedNode.y / 100) * vpSize.h * cs,
      }
      selectNode(nodeId, residual)
    } else {
      selectNode(nodeId)
    }
  }

  // ---- Node dragging ----
  const draggingNodeRef = useRef<string | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)

  // MPD curtain transition state
  const [mpdCurtain, setMpdCurtain] = useState<{
    oldModel: Model
    oldSceneStyle: React.CSSProperties
    progress: number
    direction: 'left' | 'right'
  } | null>(null)
  const curtainRaf = useRef<number>(0)

  /** Convert a client (screen) position to scene-percentage coords */
  const clientToScene = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current
    if (!el) return { x: 50, y: 50 }
    const rect = el.getBoundingClientRect()
    // Account for scene transform: translate + scale
    const cs = frame.snapshot.cameraScale
    let cx = 0, cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * cs
      cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * cs
    }
    const ox = frame.panOffset.x + cx
    const oy = frame.panOffset.y + cy
    // Scene local pixel coords
    const localX = (clientX - rect.left - rect.width / 2 - ox) / cs + rect.width / 2
    const localY = (clientY - rect.top - rect.height / 2 - oy) / cs + rect.height / 2
    return {
      x: (localX / rect.width) * 100,
      y: (localY / rect.height) * 100,
    }
  }, [frame.snapshot.cameraScale, frame.snapshot.nodeProgress, frame.panOffset.x, frame.panOffset.y, selectedNode, vpSize.w, vpSize.h])

  const handleNodeDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    draggingNodeRef.current = nodeId
    setDraggingNodeId(nodeId)
    beginMoveNode(frame.modelId)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [beginMoveNode, frame.modelId])

  const handleNodeDragMove = useCallback((e: React.PointerEvent) => {
    if (!draggingNodeRef.current) return
    const pos = clientToScene(e.clientX, e.clientY)
    moveNode(frame.modelId, draggingNodeRef.current, pos.x, pos.y)
  }, [clientToScene, frame.modelId, moveNode])

  const handleNodeDragEnd = useCallback(() => {
    draggingNodeRef.current = null
    setDraggingNodeId(null)
  }, [])

  // ---- Connection creation (right-click drag) ----
  const [connectionDraft, setConnectionDraft] = useState<{
    fromId: string
    fromX: number
    fromY: number
    toX: number
    toY: number
  } | null>(null)

  const handleConnectionDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const node = model.nodes.find((n) => n.id === nodeId)
    if (!node) return
    setConnectionDraft({
      fromId: nodeId,
      fromX: node.x,
      fromY: node.y,
      toX: node.x,
      toY: node.y,
    })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [model.nodes])

  const handleConnectionDragMove = useCallback((e: React.PointerEvent) => {
    if (!connectionDraft) return
    const pos = clientToScene(e.clientX, e.clientY)
    setConnectionDraft((d) => d ? { ...d, toX: pos.x, toY: pos.y } : null)
  }, [connectionDraft, clientToScene])

  const handleConnectionDragEnd = useCallback((e: React.PointerEvent) => {
    if (!connectionDraft) return
    // Find if pointer is over a target node
    const pos = clientToScene(e.clientX, e.clientY)
    const target = model.nodes.find((n) => {
      const dx = n.x - pos.x
      const dy = n.y - pos.y
      return Math.sqrt(dx * dx + dy * dy) < 5 // hit radius ~5% of scene
    })
    if (target && target.id !== connectionDraft.fromId) {
      addConnection(frame.modelId, { from: connectionDraft.fromId, to: target.id })
    }
    setConnectionDraft(null)
  }, [connectionDraft, clientToScene, model.nodes, frame.modelId, addConnection])

  // ---- Node creation (double-click on empty space) ----
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Only on empty space (the viewport itself)
    if (e.target !== e.currentTarget) return
    const pos = clientToScene(e.clientX, e.clientY)
    const snappedX = snapToGrid(pos.x)
    const snappedY = snapToGrid(pos.y)
    const newId = `node-${Date.now()}`
    addNode(frame.modelId, { id: newId, label: '', x: snappedX, y: snappedY })
    selectNode(newId)
    setEditingNodeId(newId)
  }, [clientToScene, frame.modelId, addNode, selectNode])

  // ---- Node deletion (Delete key) + Undo/Redo ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo(frame.modelId)
        return
      }
      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault()
        redo(frame.modelId)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete while typing in a node label
        if (editingNodeId) return
        if (frame.selectedNodeId) {
          removeNode(frame.modelId, frame.selectedNodeId)
        }
      }
      // Escape to deselect or cancel editing
      if (e.key === 'Escape') {
        if (editingNodeId) {
          // If label is still empty, remove the node
          const node = model.nodes.find((n) => n.id === editingNodeId)
          if (node && !node.label.trim()) {
            removeNode(frame.modelId, editingNodeId)
          }
          setEditingNodeId(null)
        } else {
          clearSelection()
          closeUnzip()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [frame.selectedNodeId, frame.modelId, editingNodeId, model.nodes, removeNode, clearSelection, closeUnzip, undo, redo])

  return (
    <div
      ref={viewportRef}
      className={`viewport ${isDragging ? 'dragging' : ''}`}
      onWheel={(event) => {
        event.preventDefault()
        if (event.deltaY < 0) {
          zoomIn()
        } else {
          zoomOut()
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        beginDrag()
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerMove={(event) => {
        // Node dragging takes priority
        if (draggingNodeRef.current) {
          handleNodeDragMove(event)
          return
        }
        // Connection dragging
        if (connectionDraft) {
          handleConnectionDragMove(event)
          return
        }
        if (!isDragging || !lastPointer.current) return
        const dx = event.clientX - lastPointer.current.x
        const dy = event.clientY - lastPointer.current.y
        panBy(dx, dy)
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        if (draggingNodeRef.current) {
          handleNodeDragEnd()
          return
        }
        if (connectionDraft) {
          handleConnectionDragEnd(event)
          return
        }
        endDrag()
        lastPointer.current = null
        pause()
      }}
      onPointerLeave={() => {
        handleNodeDragEnd()
        setConnectionDraft(null)
        endDrag()
        lastPointer.current = null
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          clearSelection()
          closeUnzip()
        }
      }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="debug-overlay">
        <div className="prototype-stats compact">
          <span>Selection: {frame.selectedNodeId ?? 'none'}</span>
          <span>Depth: {stack.length - 1}</span>
          <span>Model: {model.label}</span>
          <span>Progress: {frame.snapshot.progress.toFixed(2)}</span>
          <button
            className="debug-toggle"
            type="button"
            onClick={() => setDebugOpen((v) => !v)}
          >
            {debugOpen ? 'Hide Debug' : 'Show Debug'}
          </button>
        </div>
        {debugOpen && (
          <div className="prototype-stats details">
            <span>Mode: {frame.snapshot.handoffMode}</span>
            <span>Camera: {frame.snapshot.cameraScale.toFixed(2)}</span>
            <span>Inflation: {frame.snapshot.nodeInflation.toFixed(2)}</span>
            <span>Paused: {isPaused ? 'yes' : 'no'}</span>
          </div>
        )}
      </div>

      {!frame.selectedNodeId && (
        <div className="empty-hint">Click a node to select, then scroll to zoom in.</div>
      )}

      {mpdOptions && mpdOptions.length > 1 && (
        <MpdDial
          options={mpdOptions}
          activeIndex={mpdActiveIndex}
          onSelect={(idx, direction) => {
            const newModelId = mpdOptions[idx].id
            if (newModelId === frame.modelId) return

            // Compute pan offset to align twin nodes across dimensions
            let alignPan: { x: number; y: number } = { x: 0, y: 0 }
            if (frame.selectedNodeId) {
              const oldNode = model.nodes.find((n) => n.id === frame.selectedNodeId)
              const newModel = storeGetModel(newModelId)
              const twinNode = newModel?.nodes.find((n) => n.id === frame.selectedNodeId)
              if (oldNode && twinNode) {
                const cs = frame.snapshot.cameraScale
                const np = frame.snapshot.nodeProgress
                let cx = 0, cy = 0
                if (selectedNode) {
                  cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * cs
                  cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * cs
                }
                // Old node screen position (relative to viewport center)
                const oldScreenX = cx + frame.panOffset.x + cs * (oldNode.x / 100 - 0.5) * vpSize.w
                const oldScreenY = cy + frame.panOffset.y + cs * (oldNode.y / 100 - 0.5) * vpSize.h
                // New frame: scale=1, no centering → solve for panOffset
                alignPan = {
                  x: oldScreenX - (twinNode.x / 100 - 0.5) * vpSize.w,
                  y: oldScreenY - (twinNode.y / 100 - 0.5) * vpSize.h,
                }
              }
            }

            // Capture current state for curtain
            const oldModel = model
            const oldStyle = { ...sceneStyle }
            cancelAnimationFrame(curtainRaf.current)
            setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, progress: 0, direction })
            switchFrameMpd(newModelId, alignPan)
            // Animate curtain from 0 → 1
            const startTime = performance.now()
            const animate = () => {
              const elapsed = performance.now() - startTime
              const t = Math.min(elapsed / 500, 1)
              const eased = t * t * (3 - 2 * t) // smoothstep
              setMpdCurtain((prev) => prev ? { ...prev, progress: eased } : null)
              if (t < 1) {
                curtainRaf.current = requestAnimationFrame(animate)
              } else {
                setMpdCurtain(null)
              }
            }
            curtainRaf.current = requestAnimationFrame(animate)
          }}
        />
      )}

      <div className="editor-toolbar">
        <button
          type="button"
          className="toolbar-btn"
          disabled={!(undoStacks[frame.modelId]?.length)}
          onClick={() => undo(frame.modelId)}
          title="Undo (Ctrl+Z)"
        >&#x21A9; Undo</button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={!(redoStacks[frame.modelId]?.length)}
          onClick={() => redo(frame.modelId)}
          title="Redo (Ctrl+Shift+Z)"
        >&#x21AA; Redo</button>
        <span className="toolbar-sep" />
        <button
          type="button"
          className="toolbar-btn"
          disabled={!frame.selectedNodeId}
          onClick={() => { if (frame.selectedNodeId) { removeNode(frame.modelId, frame.selectedNodeId); clearSelection() } }}
          title="Delete selected node (Del)"
        >&#x2715; Delete</button>
        <span className="toolbar-sep" />
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => {
            const newId = `node-${Date.now()}`
            addNode(frame.modelId, { id: newId, label: '', x: snapToGrid(50), y: snapToGrid(50) })
            selectNode(newId)
            setEditingNodeId(newId)
          }}
          title="Add new node"
        >&#x2795; Add Node</button>
      </div>

      {/* During MPD curtain: render old model clipped, new model clipped opposite */}
      {mpdCurtain && (
        <>
          <div
            className="scene"
            style={{
              ...mpdCurtain.oldSceneStyle,
              clipPath: mpdCurtain.direction === 'left'
                ? `inset(0 ${mpdCurtain.progress * 100}% 0 0)`
                : `inset(0 0 0 ${mpdCurtain.progress * 100}%)`,
            }}
          >
            <ModelSceneContent
              model={mpdCurtain.oldModel}
              selectedNodeId={null}
              childModel={undefined}
              progress={0}
              vpSize={vpSize}
              onSelectNode={() => {}}
              onClickConnection={() => {}}
              onNodeDragStart={() => {}}
              onConnectionDragStart={() => {}}
              draggingNodeId={null}
              editingNodeId={null}
              onFinishEditing={() => {}}
              connectionDraft={null}
              unzipGap={null}
            />
          </div>
          <div
            className="mpd-curtain-line"
            style={{
              left: mpdCurtain.direction === 'left'
                ? `${(1 - mpdCurtain.progress) * 100}%`
                : `${mpdCurtain.progress * 100}%`,
            }}
          />
        </>
      )}

      <div
        className="scene"
        style={{
          ...sceneStyle,
          ...(mpdCurtain ? {
            clipPath: mpdCurtain.direction === 'left'
              ? `inset(0 0 0 ${(1 - mpdCurtain.progress) * 100}%)`
              : `inset(0 ${(1 - mpdCurtain.progress) * 100}% 0 0)`,
          } : {}),
        }}
      >
        <ModelSceneContent
          model={model}
          selectedNodeId={frame.selectedNodeId}
          childModel={childModel}
          progress={p}
          vpSize={vpSize}
          onSelectNode={handleSelectNode}
          onClickConnection={openUnzip}
          onNodeDragStart={handleNodeDragStart}
          onConnectionDragStart={handleConnectionDragStart}
          draggingNodeId={draggingNodeId}
          editingNodeId={editingNodeId}
          onFinishEditing={(nodeId, label) => {
            if (label.trim()) {
              updateNodeLabel(frame.modelId, nodeId, label.trim())
            } else {
              removeNode(frame.modelId, nodeId)
            }
            setEditingNodeId(null)
          }}
          connectionDraft={connectionDraft}
          unzipGap={unzipDisplayKey ? {
            connectionKey: unzipDisplayKey,
            progress: unzipAnimProgress,
            popupSize,
            connectionAngle: (() => {
              if (!activeUnzipPopup) return 0
              const conn = model.connections.find(
                (c) => `${c.from}->${c.to}` === activeUnzipPopup.connectionKey,
              )
              if (!conn) return 0
              const fn = model.nodes.find((n) => n.id === conn.from)
              const tn = model.nodes.find((n) => n.id === conn.to)
              if (!fn || !tn) return 0
              return Math.atan2((tn.y - fn.y) * vpSize.h, (tn.x - fn.x) * vpSize.w)
            })()
          } : null}
        />
        {activeUnzipPopup && (() => {
          const conn = model.connections.find(
            (c) => `${c.from}->${c.to}` === activeUnzipPopup.connectionKey,
          )
          if (!conn?.evidence?.length) return null
          const fromNode = model.nodes.find((n) => n.id === conn.from)
          const toNode = model.nodes.find((n) => n.id === conn.to)
          const angle = fromNode && toNode
            ? Math.atan2(
                (toNode.y - fromNode.y) * vpSize.h,
                (toNode.x - fromNode.x) * vpSize.w,
              )
            : 0
          return (
            <UnzipPopup
              connectionKey={activeUnzipPopup.connectionKey}
              level={activeUnzipPopup.level}
              evidence={conn.evidence}
              anchorX={activeUnzipPopup.anchorX}
              anchorY={activeUnzipPopup.anchorY}
              animProgress={unzipAnimProgress}
              connectionAngle={angle}
              onSizeChange={handlePopupSizeChange}
            />
          )
        })()}
      </div>
    </div>
  )
}

/** Renders all nodes and connections for a model */
function ModelSceneContent({
  model,
  selectedNodeId,
  childModel,
  progress,
  vpSize,
  onSelectNode,
  onClickConnection,
  onNodeDragStart,
  onConnectionDragStart,
  draggingNodeId,
  editingNodeId,
  onFinishEditing,
  connectionDraft,
  unzipGap,
}: {
  model: Model
  selectedNodeId: string | null
  childModel: Model | undefined
  progress: number
  vpSize: { w: number; h: number }
  onSelectNode: (id: string) => void
  onClickConnection: (connectionKey: string, anchorX: number, anchorY: number) => void
  onNodeDragStart: (nodeId: string, e: React.PointerEvent) => void
  onConnectionDragStart: (nodeId: string, e: React.PointerEvent) => void
  draggingNodeId: string | null
  editingNodeId: string | null
  onFinishEditing: (nodeId: string, label: string) => void
  connectionDraft: { fromId: string; fromX: number; fromY: number; toX: number; toY: number } | null
  unzipGap: { connectionKey: string; progress: number; popupSize: { w: number; h: number } | null; connectionAngle: number } | null
}) {
  // Compute per-node spread offsets: when a popup needs more room than the
  // connection length provides, push both endpoint nodes apart symmetrically.
  const spreadOffsets = useMemo(() => {
    const offsets: Record<string, { dx: number; dy: number }> = {}
    if (!unzipGap || !unzipGap.popupSize || unzipGap.progress < 0.001) return offsets

    const conn = model.connections.find(
      (c) => `${c.from}->${c.to}` === unzipGap.connectionKey,
    )
    if (!conn) return offsets
    const fromN = model.nodes.find((n) => n.id === conn.from)
    const toN = model.nodes.find((n) => n.id === conn.to)
    if (!fromN || !toN) return offsets

    // Connection length in pixels
    const dxPx = (toN.x - fromN.x) * vpSize.w / 100
    const dyPx = (toN.y - fromN.y) * vpSize.h / 100
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
    if (lenPx < 1) return offsets

    const angle = unzipGap.connectionAngle
    const cosA = Math.abs(Math.cos(angle))
    const sinA = Math.abs(Math.sin(angle))

    // Popup's extent along the connection axis + padding for zipper corners
    const alongExtent =
      (unzipGap.popupSize.w / 2) * cosA +
      (unzipGap.popupSize.h / 2) * sinA +
      40 // padding for zipper entry/exit + corner radius

    // How much total room is needed vs available
    const needed = alongExtent * 2
    const deficit = needed - lenPx
    if (deficit <= 0) return offsets

    // Each node moves outward by half the deficit (in percentage coordinates)
    const halfDeficit = (deficit / 2 + 8) * unzipGap.progress // +8 for breathing room
    const ux = dxPx / lenPx // unit along connection
    const uy = dyPx / lenPx
    offsets[conn.from] = {
      dx: -ux * halfDeficit * 100 / vpSize.w,
      dy: -uy * halfDeficit * 100 / vpSize.h,
    }
    offsets[conn.to] = {
      dx: ux * halfDeficit * 100 / vpSize.w,
      dy: uy * halfDeficit * 100 / vpSize.h,
    }
    return offsets
  }, [model, unzipGap, vpSize])

  // Helper: get spread-adjusted position for a node
  const pos = (node: ModelNode) => {
    const off = spreadOffsets[node.id]
    return off
      ? { x: node.x + off.dx, y: node.y + off.dy }
      : { x: node.x, y: node.y }
  }

  return (
    <>
      <svg className="child-scene-connections">
        {model.connections.map((c) => {
          const fromN = model.nodes.find((n) => n.id === c.from)
          const toN = model.nodes.find((n) => n.id === c.to)
          if (!fromN || !toN) return null
          const key = `${c.from}->${c.to}`
          const hasEvidence = !!c.evidence?.length
          const fp = pos(fromN), tp = pos(toN)
          const midX = (fp.x + tp.x) / 2
          const midY = (fp.y + tp.y) / 2
          const isUnzipping = unzipGap?.connectionKey === key
          const gapT = isUnzipping ? unzipGap.progress : 0
          return (
            <g key={key}>
              {hasEvidence && (
                <line
                  x1={`${fp.x}%`} y1={`${fp.y}%`}
                  x2={`${tp.x}%`} y2={`${tp.y}%`}
                  className="connection-hit-area"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClickConnection(key, midX, midY)
                  }}
                />
              )}
              <ConnectionLine
                fromX={fp.x} fromY={fp.y}
                toX={tp.x} toY={tp.y}
                hasEvidence={hasEvidence}
                gapProgress={gapT}
                vpSize={vpSize}
                popupSize={isUnzipping ? unzipGap?.popupSize ?? null : null}
                connectionAngle={isUnzipping ? unzipGap?.connectionAngle ?? 0 : 0}
              />
            </g>
          )
        })}
        {connectionDraft && (
          <line
            x1={`${connectionDraft.fromX}%`} y1={`${connectionDraft.fromY}%`}
            x2={`${connectionDraft.toX}%`} y2={`${connectionDraft.toY}%`}
            className="connection-draft"
          />
        )}
      </svg>
      {model.nodes.map((node) => {
        const p = pos(node)
        return (
          <SceneNode
            key={node.id}
            node={node}
            posX={p.x}
            posY={p.y}
            isSelected={node.id === selectedNodeId}
            isZooming={node.id === selectedNodeId && progress > 0}
            progress={node.id === selectedNodeId ? progress : 0}
            childModel={node.id === selectedNodeId ? childModel : undefined}
            vpSize={vpSize}
            onSelect={() => onSelectNode(node.id)}
            onDragStart={(e) => onNodeDragStart(node.id, e)}
            onConnectionDragStart={(e) => onConnectionDragStart(node.id, e)}
            isDragging={node.id === draggingNodeId}
            isEditing={node.id === editingNodeId}
            onFinishEditing={(label) => onFinishEditing(node.id, label)}
          />
        )
      })}
    </>
  )
}

/** Connection line that bows outward into a zipper-bag shape during unzip */
function ConnectionLine({
  fromX, fromY, toX, toY, hasEvidence, gapProgress, vpSize, popupSize, connectionAngle,
}: {
  fromX: number; fromY: number
  toX: number; toY: number
  hasEvidence: boolean
  gapProgress: number
  vpSize: { w: number; h: number }
  popupSize: { w: number; h: number } | null
  connectionAngle: number
}) {
  const lineClass = hasEvidence ? 'connection-line has-evidence' : 'connection-line'

  if (gapProgress < 0.001) {
    return (
      <line
        x1={`${fromX}%`} y1={`${fromY}%`}
        x2={`${toX}%`} y2={`${toY}%`}
        className={lineClass}
      />
    )
  }

  // Compute in screen-pixel space for correct aspect-ratio perpendicular
  const fxPx = fromX * vpSize.w / 100
  const fyPx = fromY * vpSize.h / 100
  const txPx = toX * vpSize.w / 100
  const tyPx = toY * vpSize.h / 100

  const dxPx = txPx - fxPx
  const dyPx = tyPx - fyPx
  const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
  if (lenPx < 1) return null

  // Unit vectors in pixel space
  const alongX = dxPx / lenPx
  const alongY = dyPx / lenPx
  const perpX = -alongY
  const perpY = alongX

  const midXPx = (fxPx + txPx) / 2
  const midYPx = (fyPx + tyPx) / 2

  // Trace the actual popup rectangle edges rather than a rotated bounding box.
  // For each track (+1 / -1), find the popup corners on that side of the
  // connection line and route the path around them with rounded corners.

  const padding = 16 // px clearance beyond popup edge

  function buildTrackForPopup(sign: number): string {
    const hw = (popupSize!.w / 2 + padding) * gapProgress
    const hh = (popupSize!.h / 2 + padding) * gapProgress

    // Ray from mid along the connection direction hits the popup boundary at parameter t
    let t = Infinity
    if (Math.abs(alongX) > 1e-9) t = Math.min(t, hw / Math.abs(alongX))
    if (Math.abs(alongY) > 1e-9) t = Math.min(t, hh / Math.abs(alongY))
    // Don't let entry/exit overshoot connection endpoints
    t = Math.min(t, lenPx / 2 - 1)
    if (t <= 0) return `M ${fxPx} ${fyPx} L ${txPx} ${tyPx}`

    // Entry (toward 'from') and exit (toward 'to') on the popup boundary
    const entAbs = { x: midXPx - alongX * t, y: midYPx - alongY * t }
    const extAbs = { x: midXPx + alongX * t, y: midYPx + alongY * t }

    // Which edge is the exit point on?
    // 0=top(y=-hh), 1=right(x=+hw), 2=bottom(y=+hh), 3=left(x=-hw)
    const extRx = alongX * t, extRy = alongY * t
    const eps = 0.5
    let exitEdge: number
    if (Math.abs(extRx - hw) < eps) exitEdge = 1
    else if (Math.abs(extRx + hw) < eps) exitEdge = 3
    else if (Math.abs(extRy - hh) < eps) exitEdge = 2
    else exitEdge = 0
    const entryEdge = (exitEdge + 2) % 4

    // Corners in CW order: TL(0), TR(1), BR(2), BL(3)
    const cornerPos: [number, number][] = [
      [midXPx - hw, midYPx - hh],
      [midXPx + hw, midYPx - hh],
      [midXPx + hw, midYPx + hh],
      [midXPx - hw, midYPx + hh],
    ]

    // Edge e runs CW from corner e to corner (e+1)%4.
    // Collect corners going CW from entry edge to exit edge.
    const cwIdx: number[] = []
    let e = entryEdge
    while (true) {
      cwIdx.push((e + 1) % 4)
      e = (e + 1) % 4
      if (e === exitEdge) break
    }
    // CCW corners
    const ccwIdx: number[] = []
    e = entryEdge
    while (true) {
      ccwIdx.push(e)
      e = (e - 1 + 4) % 4
      if (e === exitEdge) break
    }

    // Determine which direction corresponds to +perp side
    const cwPerp = cwIdx.reduce((s, ci) =>
      s + (cornerPos[ci][0] - midXPx) * perpX + (cornerPos[ci][1] - midYPx) * perpY, 0)
    const myIdx = (cwPerp * sign > 0) ? cwIdx : ccwIdx
    const myCorners = myIdx.map(ci => ({ x: cornerPos[ci][0], y: cornerPos[ci][1] }))

    if (myCorners.length === 0) {
      return `M ${fxPx} ${fyPx} L ${txPx} ${tyPx}`
    }

    // Waypoints: from, entry, popup-corners..., exit, to
    const wp = [
      { x: fxPx, y: fyPx },
      entAbs,
      ...myCorners,
      extAbs,
      { x: txPx, y: tyPx },
    ]

    // Build path with quadratic-bezier rounded corners at indices 1..length-2
    const cr = Math.min(hw, hh, 28)
    let path = `M ${wp[0].x} ${wp[0].y}`
    for (let i = 1; i < wp.length; i++) {
      if (i < wp.length - 1) {
        const prev = wp[i - 1], curr = wp[i], next = wp[i + 1]
        let dx1 = curr.x - prev.x, dy1 = curr.y - prev.y
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
        let dx2 = next.x - curr.x, dy2 = next.y - curr.y
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
        if (len1 < 0.5 || len2 < 0.5) { path += ` L ${curr.x} ${curr.y}`; continue }
        dx1 /= len1; dy1 /= len1
        dx2 /= len2; dy2 /= len2
        const r = Math.min(cr, len1 / 2, len2 / 2)
        path += ` L ${curr.x - dx1 * r} ${curr.y - dy1 * r}`
        path += ` Q ${curr.x} ${curr.y} ${curr.x + dx2 * r} ${curr.y + dy2 * r}`
      } else {
        path += ` L ${wp[i].x} ${wp[i].y}`
      }
    }
    return path
  }

  // Fallback track for when popup size isn't known yet
  function buildFallbackTrack(sign: number): string {
    const bow = Math.min(lenPx * 0.18, 110) * gapProgress
    const cpx = midXPx + perpX * bow * sign
    const cpy = midYPx + perpY * bow * sign
    const sAx = fxPx + alongX * lenPx * 0.30
    const sAy = fyPx + alongY * lenPx * 0.30
    const sBx = fxPx + alongX * lenPx * 0.70
    const sBy = fyPx + alongY * lenPx * 0.70
    return `M ${fxPx} ${fyPx} L ${sAx} ${sAy} Q ${cpx} ${cpy} ${sBx} ${sBy} L ${txPx} ${tyPx}`
  }

  const hasPopup = popupSize && popupSize.w > 0 && popupSize.h > 0
  const d1 = hasPopup ? buildTrackForPopup(+1) : buildFallbackTrack(+1)
  const d2 = hasPopup ? buildTrackForPopup(-1) : buildFallbackTrack(-1)

  return (
    <>
      <path d={d1} className={lineClass} fill="none" />
      <path d={d2} className={lineClass} fill="none" />
    </>
  )
}

/** A single node that can expand its canvas when zooming */
function SceneNode({
  node,
  posX,
  posY,
  isSelected,
  isZooming,
  progress,
  childModel,
  vpSize,
  onSelect,
  onDragStart,
  onConnectionDragStart,
  isDragging,
  isEditing,
  onFinishEditing,
}: {
  node: ModelNode
  posX: number
  posY: number
  isSelected: boolean
  isZooming: boolean
  progress: number
  childModel: Model | undefined
  vpSize: { w: number; h: number }
  onSelect: () => void
  onDragStart: (e: React.PointerEvent) => void
  onConnectionDragStart: (e: React.PointerEvent) => void
  isDragging: boolean
  isEditing: boolean
  onFinishEditing: (label: string) => void
}) {
  const labelRef = useRef<HTMLDivElement>(null)
  const [baseSize, setBaseSize] = useState({ w: NODE_MIN_W, h: NODE_MIN_H })

  useEffect(() => {
    const el = labelRef.current
    if (!el) return
    const pad = 32 + 4
    const vPad = 28 + 4
    setBaseSize({
      w: Math.max(NODE_MIN_W, el.scrollWidth + pad),
      h: Math.max(NODE_MIN_H, el.scrollHeight + vPad),
    })
  }, [node.label])

  const targetW = vpSize.w / CAMERA_SCALE_FINAL
  const targetH = vpSize.h / CAMERA_SCALE_FINAL

  const nodeW = baseSize.w + (targetW - baseSize.w) * progress
  const nodeH = baseSize.h + (targetH - baseSize.h) * progress

  const chromeFade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1

  const style: React.CSSProperties = {
    left: `${posX}%`,
    top: `${posY}%`,
    transition: isDragging ? 'none' : 'left 0.35s cubic-bezier(0.25,0.1,0.25,1), top 0.35s cubic-bezier(0.25,0.1,0.25,1)',
    width: nodeW,
    minWidth: baseSize.w,
    height: nodeH,
    minHeight: baseSize.h,
    transform: 'translate(-50%, -50%)',
    borderColor: `rgba(54, 95, 143, ${chromeFade})`,
    background: chromeFade > 0.01
      ? `linear-gradient(145deg, rgba(244,248,253,${chromeFade}), rgba(223,233,245,${chromeFade}))`
      : 'transparent',
    boxShadow: chromeFade > 0.01
      ? `0 10px 30px rgba(19, 41, 73, ${0.2 * chromeFade})`
      : 'none',
    borderRadius: 18 * chromeFade,
    padding: chromeFade > 0.01 ? `${14 * chromeFade}px ${16 * chromeFade}px` : 0,
    zIndex: isZooming ? 10 : 1,
  }

  const [editLabel, setEditLabel] = useState(node.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      setEditLabel(node.label)
      inputRef.current.focus()
    }
  }, [isEditing, node.label])

  return (
    <article
      className={`host-node ${isSelected ? 'focused' : ''}`}
      style={style}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onPointerDown={(e) => {
        if (e.button === 0 && !isEditing) {
          onDragStart(e)
        } else if (e.button === 2) {
          onConnectionDragStart(e)
        }
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          className="host-label-input"
          value={editLabel}
          onChange={(e) => setEditLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinishEditing(editLabel)
            if (e.key === 'Escape') onFinishEditing('')
          }}
          onBlur={() => onFinishEditing(editLabel)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          ref={labelRef}
          className="host-label"
          style={{ opacity: chromeFade, visibility: chromeFade > 0.01 ? 'visible' : 'hidden' }}
        >
          {node.label || '\u00A0'}
        </div>
      )}
      {isZooming && childModel && (
        <div className="child-model">
          <ChildModelPreview
            model={childModel}
            scale={nodeW / vpSize.w}
          />
        </div>
      )}
    </article>
  )
}

/** Preview of child model content inside a node canvas */
function ChildModelPreview({ model, scale }: { model: Model; scale: number }) {
  return (
    <>
      <svg className="child-scene-connections">
        {model.connections.map((c) => {
          const from = model.nodes.find((n) => n.id === c.from)
          const to = model.nodes.find((n) => n.id === c.to)
          if (!from || !to) return null
          return (
            <line
              key={`${c.from}-${c.to}`}
              x1={`${from.x}%`} y1={`${from.y}%`}
              x2={`${to.x}%`} y2={`${to.y}%`}
              strokeWidth={2 * scale}
            />
          )
        })}
      </svg>
      {model.nodes.map((node) => (
        <div
          key={node.id}
          className="child-scene-node"
          style={{
            left: `${node.x}%`,
            top: `${node.y}%`,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}
        >
          {node.label}
        </div>
      ))}
    </>
  )
}
