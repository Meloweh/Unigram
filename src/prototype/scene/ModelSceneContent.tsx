import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Model, type ModelNode, type ConnectionType } from '../model/sampleModels'
import { useHybridZoomStore } from '../model/useHybridZoomStore'
import { resolvePalette } from '../theme/themes'
import { computeEdgeAnchors } from './edgeAnchoring'
import { SCENE_W, SCENE_H, LOD_FULL, LOD_SIMPLE, NODE_MIN_W, NODE_MIN_H } from './sceneConstants'
import { SceneNode } from './SceneNode'
import { buildNodeMap } from './spatialIndex'
import { pixiLayers } from './pixiLayers'
import { syncConnections, syncDraftLine, destroyAllConnections } from './PixiConnectionRenderer'
import type { ConnectionRenderData } from './PixiConnectionRenderer'
import { syncDotNodes, destroyAllDotNodes } from './PixiDotNode'
import { syncSimplifiedNodes, destroyAllSimplifiedNodes } from './PixiSimplifiedNode'
import type { SimplifiedNodeData } from './PixiSimplifiedNode'
import { syncFullNodes, destroyAllFullNodes } from './PixiNodeRenderer'
import type { FullNodeData } from './PixiNodeRenderer'

/** Renders all nodes and connections for a model */
function ModelSceneContentInner({
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

  // Memoized position map — avoids creating new { x, y } objects on every render
  const positionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    for (const node of model.nodes) {
      const off = spreadOffsets[node.id]
      map.set(node.id, off
        ? { x: node.x + off.dx, y: node.y + off.dy }
        : { x: node.x, y: node.y })
    }
    return map
  }, [model.nodes, spreadOffsets])

  const anchors = useMemo(
    () => computeEdgeAnchors(model.nodes, model.connections, SCENE_W, SCENE_H, pos, nodeSizesRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, spreadOffsets, sizeGen],
  )

  // ─── PixiJS connection sync ─────────────────────────────────────────
  const onClickConnectionRef = useRef(onClickConnection)
  onClickConnectionRef.current = onClickConnection

  const pixiConnectionData = useMemo(() => {
    const result: ConnectionRenderData[] = []
    const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
    for (const c of model.connections) {
      const fromN = nodeMap.get(c.from)
      const toN = nodeMap.get(c.to)
      if (!fromN || !toN) continue
      if (c.hideDuringFlow && isFlowRunning) continue
      const key = `${c.from}->${c.to}`
      const hasEvidence = !!c.evidence?.length
      const a = anchors[key]
      if (!a) continue
      const isUnzipping = unzipGap?.connectionKey === key
      const gapT = isUnzipping ? unzipGap.progress : 0
      const emergeT = emergeAnimations.get(key)
      const effToX = emergeT != null ? a.fx + (a.tx - a.fx) * emergeT : a.tx
      const effToY = emergeT != null ? a.fy + (a.ty - a.fy) * emergeT : a.ty
      const isFlow = c.type === 'flow'
      const baseStrokeWidth = c.strokeWidth ?? (isFlow ? 3 : 2)
      const emergeStrokeWidth = emergeT != null ? baseStrokeWidth * emergeT : undefined

      result.push({
        key,
        fromX: a.fx,
        fromY: a.fy,
        toX: effToX,
        toY: effToY,
        hasEvidence,
        connectionType: c.type,
        flowProgress: flowAnimations.get(key),
        strokeColor: c.strokeColor,
        strokeWidth: emergeStrokeWidth ?? c.strokeWidth,
        strokeDash: c.strokeDash,
        arrowStyle: c.arrowStyle,
        label: c.label,
        labelFontSize: c.labelFontSize,
        gapProgress: gapT,
        popupSize: isUnzipping ? unzipGap?.popupSize ?? null : null,
        connectionAngle: isUnzipping ? unzipGap?.connectionAngle ?? 0 : 0,
      })
    }
    return result
  }, [model.connections, nodeMap, anchors, flowAnimations, emergeAnimations, flowActiveNodes, unzipGap])

  useEffect(() => {
    const layer = pixiLayers.connections
    if (!layer) return
    syncConnections(layer, pixiConnectionData, (key, ax, ay) => {
      onClickConnectionRef.current(key, ax, ay)
    })
  }, [pixiConnectionData])

  useEffect(() => {
    const layer = pixiLayers.connections
    if (!layer) return
    syncDraftLine(
      layer,
      connectionDraft
        ? { fromX: connectionDraft.fromX, fromY: connectionDraft.fromY, toX: connectionDraft.toX, toY: connectionDraft.toY, connectionType: connectionDraft.connectionType }
        : null,
    )
  }, [connectionDraft])

  // Cleanup PixiJS connections on unmount
  useEffect(() => destroyAllConnections, [])

  // ─── PixiJS LOD node sync (dots + simplified) ───────────────────────
  const pixiLodData = useMemo(() => {
    const dots: { id: string; x: number; y: number; cellColor: string }[] = []
    const simplified: SimplifiedNodeData[] = []
    const scale = effectiveScale ?? 1
    const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
    for (const node of model.nodes) {
      if (node.hideDuringFlow && isFlowRunning) continue
      const p = positionMap.get(node.id) ?? { x: node.x, y: node.y }
      const isImportant = node.id === selectedNodeId
        || node.id === editingNodeId
        || node.id === draggingNodeId
        || (selectedNodeIds?.has(node.id) ?? false)
        || (draggingMultiIds?.has(node.id) ?? false)
      if (isImportant) continue
      if (scale < LOD_SIMPLE) {
        dots.push({ id: node.id, x: p.x, y: p.y, cellColor: node.cellColor ?? palette.nodeCell })
      } else if (scale < LOD_FULL) {
        simplified.push({
          id: node.id, x: p.x, y: p.y,
          cellColor: node.cellColor ?? palette.nodeCell,
          membraneColor: node.membraneColor ?? palette.nodeMembrane,
          w: node.nodeWidth ?? NODE_MIN_W,
          h: node.nodeHeight ?? NODE_MIN_H,
          label: node.label,
        })
      }
    }
    return { dots, simplified }
  }, [model.nodes, positionMap, effectiveScale, flowActiveNodes, flowAnimations, selectedNodeId, editingNodeId, draggingNodeId, selectedNodeIds, draggingMultiIds, palette])

  useEffect(() => {
    const layer = pixiLayers.nodes
    if (!layer) return
    syncDotNodes(layer, pixiLodData.dots)
    syncSimplifiedNodes(layer, pixiLodData.simplified)
  }, [pixiLodData])

  // Cleanup PixiJS LOD nodes on unmount
  useEffect(() => () => { destroyAllDotNodes(); destroyAllSimplifiedNodes() }, [])

  // ─── Determine which nodes use PixiJS vs SceneNode ──────────────────
  // Nodes needing SceneNode: cosmetic, media/content, or zooming with child
  const needsSceneNode = useCallback((node: ModelNode) => {
    if (node.cosmeticType) return true
    if (node.mediaType) return true
    return false
  }, [])

  // ─── PixiJS full-node sync (standard label nodes at LOD_FULL) ───────
  const pixiFullNodeData = useMemo(() => {
    const result: FullNodeData[] = []
    const scale = effectiveScale ?? 1
    if (scale < LOD_FULL) return result // LOD handles lower zooms
    const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
    for (const node of model.nodes) {
      if (node.hideDuringFlow && isFlowRunning) continue
      if (needsSceneNode(node)) continue
      // Nodes being zoomed with a child model need SceneNode for the preview
      if (node.id === selectedNodeId && progress > 0) continue
      const p = positionMap.get(node.id) ?? { x: node.x, y: node.y }
      const isImportant = node.id === selectedNodeId
        || node.id === editingNodeId
        || node.id === draggingNodeId
        || (selectedNodeIds?.has(node.id) ?? false)
        || (draggingMultiIds?.has(node.id) ?? false)
      const nodeProgress = node.id === selectedNodeId ? progress : 0
      const chromeFade = nodeProgress > 0.7 ? 1 - (nodeProgress - 0.7) / 0.3 : 1
      result.push({
        id: node.id,
        x: p.x,
        y: p.y,
        label: node.label,
        shape: node.shape ?? 'rounded-rect',
        cellColor: node.cellColor ?? palette.nodeCell,
        membraneColor: node.membraneColor ?? palette.nodeMembrane,
        membraneVisible: node.membraneVisible !== false,
        nodeWidth: node.nodeWidth,
        nodeHeight: node.nodeHeight,
        isSelected: node.id === selectedNodeId || (selectedNodeIds?.has(node.id) ?? false),
        isMultiSelected: selectedNodeIds?.has(node.id) ?? false,
        isFlowActive: flowActiveNodes.has(node.id),
        isFlowRunning: isFlowRunning,
        isEditing: node.id === editingNodeId,
        chromeFade,
      })
    }
    return result
  }, [model.nodes, positionMap, effectiveScale, selectedNodeId, selectedNodeIds, editingNodeId, draggingNodeId, draggingMultiIds, flowActiveNodes, flowAnimations, progress, palette, needsSceneNode])

  useEffect(() => {
    const layer = pixiLayers.nodes
    if (!layer) return
    syncFullNodes(layer, pixiFullNodeData, handleNodeResize)
  }, [pixiFullNodeData, handleNodeResize])

  // Cleanup PixiJS full nodes on unmount
  useEffect(() => destroyAllFullNodes, [])

  // ─── Editing textarea for PixiJS-rendered nodes ─────────────────────
  const editRef = useRef<HTMLTextAreaElement>(null)
  const pendingFocusRef = useRef(false)

  // Set of node IDs rendered by PixiJS (for the current frame)
  const pixiRenderedIds = useMemo(() => {
    const s = new Set<string>()
    for (const d of pixiFullNodeData) s.add(d.id)
    return s
  }, [pixiFullNodeData])

  // Auto-focus textarea when entering edit mode on a PixiJS node
  useEffect(() => {
    if (editingNodeId && pixiRenderedIds.has(editingNodeId)) {
      pendingFocusRef.current = true
    }
  }, [editingNodeId, pixiRenderedIds])

  useEffect(() => {
    if (pendingFocusRef.current && editRef.current) {
      pendingFocusRef.current = false
      const el = editRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  })

  return (
    <>
      {/* ── Editing textarea overlay for the single PixiJS node being edited ── */}
      {editingNodeId && pixiRenderedIds.has(editingNodeId) && (() => {
        const data = pixiFullNodeData.find(d => d.id === editingNodeId)
        const node = nodeMap.get(editingNodeId)
        if (!data || !node) return null
        const storedSize = nodeSizesRef.current.get(editingNodeId)
        const w = storedSize?.w ?? node.nodeWidth ?? NODE_MIN_W
        const h = storedSize?.h ?? node.nodeHeight ?? NODE_MIN_H
        return (
          <div
            key={`edit-${editingNodeId}`}
            data-node-id={editingNodeId}
            style={{
              position: 'absolute',
              left: `${data.x}%`,
              top: `${data.y}%`,
              width: w,
              height: h,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              zIndex: 1,
              boxSizing: 'border-box',
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <textarea
              ref={editRef}
              className="host-label host-label-editing"
              defaultValue={node.label}
              rows={1}
              style={{
                width: '100%',
                minHeight: '100%',
                padding: '14px 16px',
                boxSizing: 'border-box',
                border: 'none',
                background: 'transparent',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                color: 'inherit',
                whiteSpace: 'pre',
                fieldSizing: 'content' as any,
              }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = el.scrollHeight + 'px'
                onLiveEditLabel(editingNodeId, el.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onFinishEditing(editingNodeId, (e.target as HTMLTextAreaElement).value.trim())
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  onFinishEditing(editingNodeId, '')
                }
              }}
              onBlur={() => {
                if (editRef.current) {
                  onFinishEditing(editingNodeId, editRef.current.value.trim())
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
        )
      })()}

      {/* ── Resize handles for the single selected PixiJS node ── */}
      {selectedNodeId && !editingNodeId && pixiRenderedIds.has(selectedNodeId) && onResizeDragStart && (() => {
        const data = pixiFullNodeData.find(d => d.id === selectedNodeId)
        if (!data || data.isFlowRunning) return null
        const storedSize = nodeSizesRef.current.get(selectedNodeId)
        const node = nodeMap.get(selectedNodeId)
        if (!node) return null
        const w = storedSize?.w ?? node.nodeWidth ?? NODE_MIN_W
        const h = storedSize?.h ?? node.nodeHeight ?? NODE_MIN_H
        return (
          <div
            key={`resize-${selectedNodeId}`}
            style={{
              position: 'absolute',
              left: `${data.x}%`,
              top: `${data.y}%`,
              width: w,
              height: h,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              zIndex: 1,
              boxSizing: 'border-box',
            }}
          >
            {[
              { dir: 'n', style: { top: -3, left: 8, right: 8, height: 6 } as const, cursor: 'n-resize' },
              { dir: 's', style: { bottom: -3, left: 8, right: 8, height: 6 } as const, cursor: 's-resize' },
              { dir: 'w', style: { left: -3, top: 8, bottom: 8, width: 6 } as const, cursor: 'w-resize' },
              { dir: 'e', style: { right: -3, top: 8, bottom: 8, width: 6 } as const, cursor: 'e-resize' },
              { dir: 'nw', style: { top: -4, left: -4, width: 8, height: 8 } as const, cursor: 'nw-resize' },
              { dir: 'ne', style: { top: -4, right: -4, width: 8, height: 8 } as const, cursor: 'ne-resize' },
              { dir: 'sw', style: { bottom: -4, left: -4, width: 8, height: 8 } as const, cursor: 'sw-resize' },
              { dir: 'se', style: { bottom: -4, right: -4, width: 8, height: 8 } as const, cursor: 'se-resize' },
            ].map(({ dir, style, cursor }) => (
              <div
                key={dir}
                style={{
                  position: 'absolute',
                  ...style,
                  cursor,
                  zIndex: 20,
                  pointerEvents: 'auto',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onResizeDragStart!(selectedNodeId, dir, e)
                }}
              />
            ))}
          </div>
        )
      })()}

      {/* ── SceneNode for cosmetic/media/content/zooming nodes ── */}
      {model.nodes.map((node) => {
        const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
        if (node.hideDuringFlow && isFlowRunning) return null
        const p = positionMap.get(node.id) ?? { x: node.x, y: node.y }
        const isImportant = node.id === selectedNodeId
          || node.id === editingNodeId
          || node.id === draggingNodeId
          || (selectedNodeIds?.has(node.id) ?? false)
          || (draggingMultiIds?.has(node.id) ?? false)
        if (visibleRect && !isImportant) {
          if (p.x < visibleRect.minX || p.x > visibleRect.maxX || p.y < visibleRect.minY || p.y > visibleRect.maxY) return null
        }
        const scale = effectiveScale ?? 1
        // LOD: dots and simplified nodes are rendered via PixiJS — skip DOM for those
        if (!isImportant && scale < LOD_FULL) return null
        // Skip nodes rendered by PixiJS full-node renderer
        if (pixiRenderedIds.has(node.id)) return null
        // This node needs SceneNode: cosmetic, media/content, or zooming with child preview
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

/**
 * React.memo with custom comparator — skip re-render when only
 * visibleRect changes (PixiJS ticker handles viewport culling).
 */
export const ModelSceneContent = memo(ModelSceneContentInner, (prev, next) => {
  const keys = Object.keys(next) as (keyof typeof next)[]
  for (const key of keys) {
    if (key === 'visibleRect') continue
    if (prev[key] !== next[key]) return false
  }
  return true
})
