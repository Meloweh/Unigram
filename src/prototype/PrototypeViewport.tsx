import { useEffect, useMemo, useRef, useState } from 'react'
import { CAMERA_SCALE_FINAL } from './hybridZoom'
import { getModel, type Model, type ModelNode } from './sampleModels'
import { UnzipPopup } from './UnzipPopup'
import { useHybridZoomStore, type UnzipPopupState } from './useHybridZoomStore'

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
  } = useHybridZoomStore()

  const frame = currentFrame()
  const model = getModel(frame.modelId)!
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
  const childModel = selectedNode?.childModelId ? getModel(selectedNode.childModelId) : undefined

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
        if (!isDragging || !lastPointer.current) return
        const dx = event.clientX - lastPointer.current.x
        const dy = event.clientY - lastPointer.current.y
        panBy(dx, dy)
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={() => {
        endDrag()
        lastPointer.current = null
        pause()
      }}
      onPointerLeave={() => {
        endDrag()
        lastPointer.current = null
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          clearSelection()
          closeUnzip()
        }
      }}
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

      <div className="scene" style={sceneStyle}>
        <ModelSceneContent
          model={model}
          selectedNodeId={frame.selectedNodeId}
          childModel={childModel}
          progress={p}
          vpSize={vpSize}
          onSelectNode={handleSelectNode}
          onClickConnection={openUnzip}
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
  unzipGap,
}: {
  model: Model
  selectedNodeId: string | null
  childModel: Model | undefined
  progress: number
  vpSize: { w: number; h: number }
  onSelectNode: (id: string) => void
  onClickConnection: (connectionKey: string, anchorX: number, anchorY: number) => void
  unzipGap: { connectionKey: string; progress: number; popupSize: { w: number; h: number } | null; connectionAngle: number } | null
}) {
  return (
    <>
      <svg className="child-scene-connections">
        {model.connections.map((c) => {
          const from = model.nodes.find((n) => n.id === c.from)
          const to = model.nodes.find((n) => n.id === c.to)
          if (!from || !to) return null
          const key = `${c.from}->${c.to}`
          const hasEvidence = !!c.evidence?.length
          const midX = (from.x + to.x) / 2
          const midY = (from.y + to.y) / 2
          const isUnzipping = unzipGap?.connectionKey === key
          const gapT = isUnzipping ? unzipGap.progress : 0
          return (
            <g key={key}>
              {hasEvidence && (
                <line
                  x1={`${from.x}%`} y1={`${from.y}%`}
                  x2={`${to.x}%`} y2={`${to.y}%`}
                  className="connection-hit-area"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClickConnection(key, midX, midY)
                  }}
                />
              )}
              <ConnectionLine
                fromX={from.x} fromY={from.y}
                toX={to.x} toY={to.y}
                hasEvidence={hasEvidence}
                gapProgress={gapT}
                vpSize={vpSize}
                popupSize={isUnzipping ? unzipGap?.popupSize ?? null : null}
                connectionAngle={isUnzipping ? unzipGap?.connectionAngle ?? 0 : 0}
              />
            </g>
          )
        })}
      </svg>
      {model.nodes.map((node) => (
        <SceneNode
          key={node.id}
          node={node}
          isSelected={node.id === selectedNodeId}
          isZooming={node.id === selectedNodeId && progress > 0}
          progress={node.id === selectedNodeId ? progress : 0}
          childModel={node.id === selectedNodeId ? childModel : undefined}
          vpSize={vpSize}
          onSelect={() => onSelectNode(node.id)}
        />
      ))}
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

  // Project popup rectangle onto connection's perpendicular and along axes
  // to dynamically size both the bow width AND the zipper length.
  const padding = 20 // px clearance beyond popup edge
  let bowPx: number
  let splitFracA = 0.30
  let splitFracB = 0.70
  let cornerR = 0

  if (popupSize && popupSize.w > 0 && popupSize.h > 0) {
    const cosA = Math.abs(Math.cos(connectionAngle))
    const sinA = Math.abs(Math.sin(connectionAngle))

    // Half-extent of popup projected onto connection's perpendicular axis
    const perpExtent = (popupSize.w / 2) * sinA + (popupSize.h / 2) * cosA
    bowPx = (perpExtent + padding) * gapProgress

    // Half-extent of popup projected onto connection's along axis
    const alongExtent = (popupSize.w / 2) * cosA + (popupSize.h / 2) * sinA
    // Corner radius for smooth rectangular turns (kappa ≈ 0.55)
    cornerR = Math.min(bowPx * 0.55, 60)
    // Split points must clear the popup + corners along the connection direction
    const splitMargin = (alongExtent + padding + cornerR) / lenPx
    splitFracA = Math.max(0.05, 0.5 - splitMargin)
    splitFracB = Math.min(0.95, 0.5 + splitMargin)
  } else {
    bowPx = Math.min(lenPx * 0.18, 110) * gapProgress
  }

  // Split points: where the line departs from / rejoins the connection
  const splitAx = fxPx + alongX * lenPx * splitFracA
  const splitAy = fyPx + alongY * lenPx * splitFracA
  const splitBx = fxPx + alongX * lenPx * splitFracB
  const splitBy = fyPx + alongY * lenPx * splitFracB

  // Build a track that wraps around one side of the popup.
  // sign = +1 or -1 for the two sides of the connection.
  function buildTrack(sign: number): string {
    const offX = perpX * bowPx * sign
    const offY = perpY * bowPx * sign

    if (cornerR < 1) {
      // Fallback: single quadratic bezier (small bow / no popup size)
      const cpx = midXPx + offX
      const cpy = midYPx + offY
      return `M ${fxPx} ${fyPx} L ${splitAx} ${splitAy} Q ${cpx} ${cpy} ${splitBx} ${splitBy} L ${txPx} ${tyPx}`
    }

    // Side points: offset perpendicular + shifted along by cornerR
    const sideAx = splitAx + offX + alongX * cornerR
    const sideAy = splitAy + offY + alongY * cornerR
    const sideBx = splitBx + offX - alongX * cornerR
    const sideBy = splitBy + offY - alongY * cornerR

    // Corner A: cubic bezier turning from connection line to parallel offset
    const cpA1x = splitAx + alongX * cornerR
    const cpA1y = splitAy + alongY * cornerR
    const cpA2x = splitAx + offX
    const cpA2y = splitAy + offY

    // Corner B: cubic bezier turning from parallel offset back to connection line
    const cpB1x = splitBx + offX
    const cpB1y = splitBy + offY
    const cpB2x = splitBx - alongX * cornerR
    const cpB2y = splitBy - alongY * cornerR

    return [
      `M ${fxPx} ${fyPx}`,
      `L ${splitAx} ${splitAy}`,
      `C ${cpA1x} ${cpA1y} ${cpA2x} ${cpA2y} ${sideAx} ${sideAy}`,
      `L ${sideBx} ${sideBy}`,
      `C ${cpB1x} ${cpB1y} ${cpB2x} ${cpB2y} ${splitBx} ${splitBy}`,
      `L ${txPx} ${tyPx}`,
    ].join(' ')
  }

  const d1 = buildTrack(+1)
  const d2 = buildTrack(-1)

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
  isSelected,
  isZooming,
  progress,
  childModel,
  vpSize,
  onSelect,
}: {
  node: ModelNode
  isSelected: boolean
  isZooming: boolean
  progress: number
  childModel: Model | undefined
  vpSize: { w: number; h: number }
  onSelect: () => void
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
    left: `${node.x}%`,
    top: `${node.y}%`,
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

  return (
    <article
      className={`host-node ${isSelected ? 'focused' : ''}`}
      style={style}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <div
        ref={labelRef}
        className="host-label"
        style={{ opacity: chromeFade, visibility: chromeFade > 0.01 ? 'visible' : 'hidden' }}
      >
        {node.label}
      </div>
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
