import { useCallback, useMemo, useRef, useState } from 'react'
import { type Model, type ModelNode, type ConnectionType } from '../model/sampleModels'
import { useHybridZoomStore } from '../model/useHybridZoomStore'
import { resolvePalette } from '../theme/themes'
import { computeEdgeAnchors } from './edgeAnchoring'
import { SCENE_W, SCENE_H, LOD_FULL, LOD_SIMPLE } from './sceneConstants'
import { SceneNode } from './SceneNode'
import { ConnectionLine } from './ConnectionLine'
import { SimplifiedNode } from './SimplifiedNode'
import { buildNodeMap } from './spatialIndex'

/** Renders all nodes and connections for a model */
export function ModelSceneContent({
  model,
  selectedNodeId,
  selectedNodeIds,
  childModel,
  progress,
  vpSize,
  visibleRect,
  effectiveScale,
  onSelectNode,
  onDoubleClickNode,
  onClickConnection,
  onNodeDragStart,
  onConnectionDragStart,
  draggingNodeId,
  draggingMultiIds,
  editingNodeId,
  onFinishEditing,
  onLiveEditLabel,
  connectionDraft,
  flowAnimations,
  emergeAnimations,
  flowActiveNodes,
  unzipGap,
  noTransition,
  initialNodeSizes,
  onNodeSizesChanged,
  onSetMedia,
  onToggleCollapse,
  onResizeDragStart,
  onTipDrag,
}: {
  model: Model
  selectedNodeId: string | null
  selectedNodeIds?: Set<string>
  childModel: Model | undefined
  progress: number
  vpSize: { w: number; h: number }
  visibleRect?: { minX: number; maxX: number; minY: number; maxY: number }
  effectiveScale?: number
  onSelectNode: (id: string) => void
  onDoubleClickNode: (id: string) => void
  onClickConnection: (connectionKey: string, anchorX: number, anchorY: number) => void
  onNodeDragStart: (nodeId: string, e: React.PointerEvent) => void
  onConnectionDragStart: (nodeId: string, e: React.PointerEvent) => void
  draggingNodeId: string | null
  draggingMultiIds?: Set<string>
  editingNodeId: string | null
  onFinishEditing: (nodeId: string, label: string) => void
  onLiveEditLabel: (nodeId: string, label: string) => void
  connectionDraft: { fromId: string; fromX: number; fromY: number; toX: number; toY: number; connectionType?: ConnectionType } | null
  flowAnimations: Map<string, number>
  emergeAnimations: Map<string, number>
  flowActiveNodes: Set<string>
  unzipGap: { connectionKey: string; progress: number; popupSize: { w: number; h: number } | null; connectionAngle: number } | null
  noTransition?: boolean
  initialNodeSizes?: Map<string, { w: number; h: number }>
  onNodeSizesChanged?: (sizes: Map<string, { w: number; h: number }>) => void
  onSetMedia?: (nodeId: string, mediaSrc: string, mediaFileName: string) => void
  onToggleCollapse?: (nodeId: string) => void
  onResizeDragStart?: (nodeId: string, dir: string, e: React.PointerEvent) => void
  onTipDrag?: (nodeId: string, tipAngle: number, tipLength: number) => void
}) {
  // Theme palette for node default colors
  const appThemeMode = useHybridZoomStore((s) => s.appThemeMode)
  const palette = resolvePalette(appThemeMode)

  // Track actual measured node sizes for accurate anchor placement
  const nodeSizesRef = useRef<Map<string, { w: number; h: number }>>(new Map())
  // Pre-seed with initial sizes if provided (avoids first-render anchor jitter)
  if (nodeSizesRef.current.size === 0 && initialNodeSizes && initialNodeSizes.size > 0) {
    nodeSizesRef.current = new Map(initialNodeSizes)
  }
  const frozenSizes = !!initialNodeSizes
  const [sizeGen, setSizeGen] = useState(0)
  const onNodeSizesChangedRef = useRef(onNodeSizesChanged)
  onNodeSizesChangedRef.current = onNodeSizesChanged
  const handleNodeResize = useCallback((id: string, size: { w: number; h: number }) => {
    if (frozenSizes) return
    const map = nodeSizesRef.current
    const prev = map.get(id)
    if (!prev || prev.w !== size.w || prev.h !== size.h) {
      map.set(id, size)
      setSizeGen(g => g + 1)
      onNodeSizesChangedRef.current?.(map)
    }
  }, [frozenSizes])

  // O(1) node lookup by ID
  const nodeMap = useMemo(() => buildNodeMap(model.nodes), [model.nodes])

  // Compute per-node spread offsets for unzip popup
  const spreadOffsets = useMemo(() => {
    const offsets: Record<string, { dx: number; dy: number }> = {}
    if (!unzipGap || !unzipGap.popupSize || unzipGap.progress < 0.001) return offsets

    const conn = model.connections.find(
      (c) => `${c.from}->${c.to}` === unzipGap.connectionKey,
    )
    if (!conn) return offsets
    const fromN = nodeMap.get(conn.from)
    const toN = nodeMap.get(conn.to)
    if (!fromN || !toN) return offsets

    const dxPx = (toN.x - fromN.x) * SCENE_W / 100
    const dyPx = (toN.y - fromN.y) * SCENE_H / 100
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
    if (lenPx < 1) return offsets

    const angle = unzipGap.connectionAngle
    const cosA = Math.abs(Math.cos(angle))
    const sinA = Math.abs(Math.sin(angle))

    const alongExtent =
      (unzipGap.popupSize.w / 2) * cosA +
      (unzipGap.popupSize.h / 2) * sinA +
      40

    const needed = alongExtent * 2
    const deficit = needed - lenPx
    if (deficit <= 0) return offsets

    const halfDeficit = (deficit / 2 + 8) * unzipGap.progress
    const ux = dxPx / lenPx
    const uy = dyPx / lenPx
    offsets[conn.from] = {
      dx: -ux * halfDeficit * 100 / SCENE_W,
      dy: -uy * halfDeficit * 100 / SCENE_H,
    }
    offsets[conn.to] = {
      dx: ux * halfDeficit * 100 / SCENE_W,
      dy: uy * halfDeficit * 100 / SCENE_H,
    }
    return offsets
  }, [model, unzipGap])

  const pos = (node: ModelNode) => {
    const off = spreadOffsets[node.id]
    return off
      ? { x: node.x + off.dx, y: node.y + off.dy }
      : { x: node.x, y: node.y }
  }

  const anchors = useMemo(
    () => computeEdgeAnchors(model.nodes, model.connections, SCENE_W, SCENE_H, pos, nodeSizesRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, spreadOffsets, sizeGen],
  )

  return (
    <>
      <svg className="child-scene-connections">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(37, 96, 149, 0.45)" />
          </marker>
          <marker id="arrowhead-evidence" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(37, 96, 149, 0.65)" />
          </marker>
          <marker id="arrowhead-flow" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
          </marker>
          {/* Dynamic markers for custom arrow styles and colors */}
          {(() => {
            const markers: React.ReactNode[] = []
            const seen = new Set<string>()
            for (const c of model.connections) {
              const color = c.strokeColor || (c.type === 'flow' ? '#f59e0b' : (c.evidence?.length ? 'rgba(37, 96, 149, 0.65)' : 'rgba(37, 96, 149, 0.45)'))
              const style = c.arrowStyle ?? 'standard'
              if (c.strokeColor && (style === 'standard' || !c.arrowStyle)) {
                const id = `arrowhead-custom-${CSS.escape(c.strokeColor)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill={c.strokeColor} />
                    </marker>
                  )
                }
              }
              if (style === 'triangle') {
                const id = `arrowhead-triangle-${CSS.escape(color)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill={color} stroke={color} strokeWidth="0.5" />
                    </marker>
                  )
                }
              }
              if (style === 'diamond') {
                const id = `arrowhead-diamond-${CSS.escape(color)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="10" markerHeight="8" refX="0" refY="4" orient="auto">
                      <polygon points="0 4, 5 0, 10 4, 5 8" fill={color} />
                    </marker>
                  )
                }
              }
              if (style === 'circle') {
                const id = `arrowhead-circle-${CSS.escape(color)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="0" refY="4" orient="auto">
                      <circle cx="4" cy="4" r="3.5" fill={color} />
                    </marker>
                  )
                }
              }
            }
            return markers
          })()}
        </defs>
        {model.connections.map((c) => {
          const fromN = nodeMap.get(c.from)
          const toN = nodeMap.get(c.to)
          if (!fromN || !toN) return null
          const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
          if (c.hideDuringFlow && isFlowRunning) return null
          const key = `${c.from}->${c.to}`
          const hasEvidence = !!c.evidence?.length
          const a = anchors[key]
          if (!a) return null
          // Viewport cull: skip if both anchor endpoints are outside the visible rect
          if (visibleRect) {
            const fxIn = a.fx >= visibleRect.minX && a.fx <= visibleRect.maxX && a.fy >= visibleRect.minY && a.fy <= visibleRect.maxY
            const txIn = a.tx >= visibleRect.minX && a.tx <= visibleRect.maxX && a.ty >= visibleRect.minY && a.ty <= visibleRect.maxY
            if (!fxIn && !txIn) return null
          }
          const midX = (a.fx + a.tx) / 2
          const midY = (a.fy + a.ty) / 2
          const isUnzipping = unzipGap?.connectionKey === key
          const gapT = isUnzipping ? unzipGap.progress : 0
          const emergeT = emergeAnimations.get(key)
          const effToX = emergeT != null ? a.fx + (a.tx - a.fx) * emergeT : a.tx
          const effToY = emergeT != null ? a.fy + (a.ty - a.fy) * emergeT : a.ty
          const isFlow = c.type === 'flow'
          const baseStrokeWidth = c.strokeWidth ?? (isFlow ? 3 : 2)
          const emergeStrokeWidth = emergeT != null ? baseStrokeWidth * emergeT : undefined
          return (
            <g key={key}>
              <line
                x1={`${a.fx}%`} y1={`${a.fy}%`}
                x2={`${effToX}%`} y2={`${effToY}%`}
                className="connection-hit-area"
                onClick={(e) => {
                  e.stopPropagation()
                  onClickConnection(key, midX, midY)
                }}
              />
              <ConnectionLine
                fromX={a.fx} fromY={a.fy}
                toX={effToX} toY={effToY}
                hasEvidence={hasEvidence}
                connectionType={c.type}
                flowProgress={flowAnimations.get(key)}
                gapProgress={gapT}
                vpSize={vpSize}
                popupSize={isUnzipping ? unzipGap?.popupSize ?? null : null}
                connectionAngle={isUnzipping ? unzipGap?.connectionAngle ?? 0 : 0}
                strokeColor={c.strokeColor}
                strokeWidth={emergeStrokeWidth ?? c.strokeWidth}
                strokeDash={c.strokeDash}
                arrowStyle={c.arrowStyle}
              />
              {c.label && !isUnzipping && (
                <text
                  x={`${midX}%`}
                  y={`${midY}%`}
                  className="connection-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: `${c.labelFontSize ?? 0.85}rem` }}
                >
                  {c.label}
                </text>
              )}
            </g>
          )
        })}
        {connectionDraft && (
          <line
            x1={`${connectionDraft.fromX}%`} y1={`${connectionDraft.fromY}%`}
            x2={`${connectionDraft.toX}%`} y2={`${connectionDraft.toY}%`}
            className={connectionDraft.connectionType === 'flow' ? 'connection-draft flow' : 'connection-draft'}
          />
        )}
      </svg>
      {model.nodes.map((node) => {
        const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
        if (node.hideDuringFlow && isFlowRunning) return null
        const p = pos(node)
        // Viewport cull: skip nodes outside visible rect (always render selected/editing/dragging)
        const isImportant = node.id === selectedNodeId
          || node.id === editingNodeId
          || node.id === draggingNodeId
          || (selectedNodeIds?.has(node.id) ?? false)
          || (draggingMultiIds?.has(node.id) ?? false)
        if (visibleRect && !isImportant) {
          if (p.x < visibleRect.minX || p.x > visibleRect.maxX || p.y < visibleRect.minY || p.y > visibleRect.maxY) return null
        }
        const scale = effectiveScale ?? 1
        // LOD: at very low zoom, render dot; at medium zoom, render simplified node
        if (!isImportant && scale < LOD_SIMPLE) {
          const cellColor = node.cellColor ?? palette.nodeCell
          return (
            <div
              key={node.id}
              data-node-id={node.id}
              style={{
                position: 'absolute',
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: cellColor,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'auto',
              }}
            />
          )
        }
        if (!isImportant && scale < LOD_FULL) {
          return (
            <SimplifiedNode
              key={node.id}
              node={node}
              posX={p.x}
              posY={p.y}
              isSelected={false}
              isDragging={!!noTransition}
              defaultCellColor={palette.nodeCell}
              defaultMembraneColor={palette.nodeMembrane}
            />
          )
        }
        return (
          <SceneNode
            key={node.id}
            node={node}
            posX={p.x}
            posY={p.y}
            isSelected={node.id === selectedNodeId || (selectedNodeIds?.has(node.id) ?? false)}
            isMultiSelected={selectedNodeIds?.has(node.id) ?? false}
            isZooming={node.id === selectedNodeId && progress > 0}
            progress={node.id === selectedNodeId ? progress : 0}
            childModel={node.id === selectedNodeId ? childModel : undefined}
            vpSize={vpSize}
            onSelect={onSelectNode}
            onDoubleClick={onDoubleClickNode}
            onDragStart={onNodeDragStart}
            onConnectionDragStart={onConnectionDragStart}
            isDragging={node.id === draggingNodeId || (draggingMultiIds?.has(node.id) ?? false) || !!noTransition}
            isEditing={node.id === editingNodeId}
            isFlowActive={flowActiveNodes.has(node.id)}
            isFlowRunning={isFlowRunning}
            onFinishEditing={onFinishEditing}
            onLiveEditLabel={onLiveEditLabel}
            onResize={handleNodeResize}
            defaultCellColor={palette.nodeCell}
            defaultMembraneColor={palette.nodeMembrane}
            onSetMedia={onSetMedia}
            onToggleCollapse={onToggleCollapse}
            onResizeDragStart={onResizeDragStart}
            onTipDrag={onTipDrag}
          />
        )
      })}
    </>
  )
}
