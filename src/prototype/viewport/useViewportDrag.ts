import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelNode, ModelConnection, ConnectionType, Model } from '../model/sampleModels'
import { SCENE_W, SCENE_H, NODE_MIN_W, NODE_MIN_H } from '../scene/sceneConstants'
import { buildNodeMap } from '../scene/spatialIndex'

import { snapToGrid, useHybridZoomStore } from '../model/useHybridZoomStore'

export interface ConnectionDraft {
  fromId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  connectionType?: ConnectionType
}

export interface ViewportDragDeps {
  model: Model
  frameModelId: string
  frameSelectedNodeId: string | null
  frameFreeScale: number
  framePanOffset: { x: number; y: number }
  frameSnapshotNodeProgress: number
  frameSnapshotCameraScale: number
  viewportRef: React.RefObject<HTMLDivElement | null>
  effectiveScale: number
  effectiveScaleRef: React.RefObject<number>
  selectedNode: ModelNode | undefined
  vpSize: { w: number; h: number }
  beginMoveNode: (modelId: string) => void
  beginEditNode: (modelId: string) => void
  moveNode: (modelId: string, nodeId: string, x: number, y: number) => void
  moveNodes: (modelId: string, moves: { nodeId: string; x: number; y: number }[]) => void
  updateNodePropsSilent: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  addConnection: (modelId: string, conn: Partial<ModelConnection>) => void
  setFreeScale: (scale: number) => void
  setPanOffset: (x: number, y: number) => void
}

export function useViewportDrag(deps: ViewportDragDeps) {
  const {
    model, frameModelId, frameSelectedNodeId, frameFreeScale,
    framePanOffset, frameSnapshotNodeProgress, frameSnapshotCameraScale,
    viewportRef, effectiveScale, effectiveScaleRef, selectedNode, vpSize,
    beginMoveNode, beginEditNode, moveNode, moveNodes,
    updateNodePropsSilent, addConnection, setFreeScale, setPanOffset,
  } = deps

  // O(1) node lookup by ID
  const nodeMap = useMemo(() => buildNodeMap(model.nodes), [model.nodes])

  // ---- Node dragging ----
  const draggingNodeRef = useRef<string | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const multiDragOffsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map())

  // ---- Node resize (edge/corner drag) ----
  const resizingRef = useRef<{
    nodeId: string
    dir: string // 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
    startClientX: number
    startClientY: number
    origW: number
    origH: number
    origX: number
    origY: number
    pendingW?: number
    pendingH?: number
    pendingX?: number
    pendingY?: number
  } | null>(null)

  // ---- Selection rectangle (right-click drag) ----
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [selectionRect, setSelectionRect] = useState<{
    startX: number; startY: number; endX: number; endY: number
  } | null>(null)
  const selectionStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const justFinishedSelectionRef = useRef(false)
  const clipboardRef = useRef<{ nodes: ModelNode[]; connections: ModelConnection[] } | null>(null)
  const lastPasteRef = useRef(0)

  // ---- Connection creation (right-click drag) ----
  const [activeConnectionType, setActiveConnectionType] = useState<ConnectionType>('default')
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null)

  // Clear multi-selection when model changes (e.g. MPD switch)
  useEffect(() => { setSelectedNodeIds(new Set()) }, [frameModelId])

  // Reset free zoom when a node is selected (animated transition + pan toward node)
  useEffect(() => {
    if (!frameSelectedNodeId || frameFreeScale === 1) return
    const node = model?.nodes ? nodeMap.get(frameSelectedNodeId) : undefined
    if (!node) return
    const startScale = frameFreeScale
    const startPanX = framePanOffset.x
    const startPanY = framePanOffset.y
    const cs = frameSnapshotCameraScale
    const targetPanX = (vpSize.w / 2 - node.x / 100 * SCENE_W) * cs
    const targetPanY = (vpSize.h / 2 - node.y / 100 * SCENE_H) * cs
    const duration = 300 // ms
    let t0: number | null = null
    let raf = 0
    const step = (ts: number) => {
      if (t0 === null) t0 = ts
      const elapsed = ts - t0
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - (1 - t) * (1 - t) // ease-out quad
      setFreeScale(startScale + (1 - startScale) * eased)
      setPanOffset(
        startPanX + (targetPanX - startPanX) * eased,
        startPanY + (targetPanY - startPanY) * eased,
      )
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [frameSelectedNodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Convert a client (screen) position to scene-percentage coords */
  const clientToScene = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current
    if (!el) return { x: 50, y: 50 }
    const rect = el.getBoundingClientRect()
    // Account for scene transform: translate + scale
    const cs = effectiveScale
    let cx = 0, cy = 0
    if (selectedNode) {
      const np = frameSnapshotNodeProgress
      cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs
      cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs
    }
    const ox = framePanOffset.x + cx
    const oy = framePanOffset.y + cy
    // Scene local pixel coords (rect.width/2 = viewport center = transform-origin)
    const localX = (clientX - rect.left - rect.width / 2 - ox) / cs + rect.width / 2
    const localY = (clientY - rect.top - rect.height / 2 - oy) / cs + rect.height / 2
    return {
      x: (localX / SCENE_W) * 100,
      y: (localY / SCENE_H) * 100,
    }
  }, [effectiveScale, frameSnapshotNodeProgress, framePanOffset.x, framePanOffset.y, selectedNode, vpSize.w, vpSize.h])

  const handleNodeDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // Locked nodes cannot be dragged
    const draggedNode = nodeMap.get(nodeId)
    if (draggedNode?.locked) return
    draggingNodeRef.current = nodeId
    setDraggingNodeId(nodeId)
    beginMoveNode(frameModelId)
    // Capture offsets for multi-drag when dragged node is in the selection
    multiDragOffsetsRef.current.clear()
    if (selectedNodeIds.has(nodeId)) {
      const pos = clientToScene(e.clientX, e.clientY)
      for (const id of selectedNodeIds) {
        const n = nodeMap.get(id)
        if (n && id !== nodeId && !n.locked) {
          multiDragOffsetsRef.current.set(id, { dx: n.x - pos.x, dy: n.y - pos.y })
        }
      }
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [beginMoveNode, frameModelId, selectedNodeIds, clientToScene, nodeMap])

  // Pending node positions for DOM-direct drag (bypass React during drag)
  const pendingNodePosRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const nodeDragRafRef = useRef<number | null>(null)
  const queuedNodePosRef = useRef<{ x: number; y: number } | null>(null)
  const nodeDragFlushTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Apply pending node positions directly to the DOM (no React re-render) */
  const applyNodeDragDOM = useCallback(() => {
    for (const [nodeId, pos] of pendingNodePosRef.current) {
      const el =
        (document.querySelector(`[data-node-wrapper="${CSS.escape(nodeId)}"]`) as HTMLElement) ??
        (document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement)
      if (el) {
        el.style.left = `${pos.x}%`
        el.style.top = `${pos.y}%`
      }
    }
  }, [])

  /** Process any queued pointer position into pendingNodePosRef */
  const drainQueue = useCallback(() => {
    const p = queuedNodePosRef.current
    if (!p || !draggingNodeRef.current) return
    queuedNodePosRef.current = null
    pendingNodePosRef.current.set(draggingNodeRef.current, { x: p.x, y: p.y })
    for (const [id, off] of multiDragOffsetsRef.current) {
      pendingNodePosRef.current.set(id, { x: p.x + off.dx, y: p.y + off.dy })
    }
  }, [])

  /** Flush pending positions to the Zustand store (triggers one React re-render) */
  const flushNodeDrag = useCallback(() => {
    drainQueue()
    if (!draggingNodeRef.current || pendingNodePosRef.current.size === 0) return
    if (multiDragOffsetsRef.current.size > 0 || pendingNodePosRef.current.size > 1) {
      const moves: { nodeId: string; x: number; y: number }[] = []
      for (const [nodeId, pos] of pendingNodePosRef.current) {
        moves.push({ nodeId, x: pos.x, y: pos.y })
      }
      moveNodes(frameModelId, moves)
    } else {
      const [nodeId, pos] = pendingNodePosRef.current.entries().next().value!
      moveNode(frameModelId, nodeId, pos.x, pos.y)
    }
    // Don't clear pendingNodePosRef — keep for final flush on drag end
  }, [drainQueue, frameModelId, moveNode, moveNodes])

  const handleNodeDragMove = useCallback((e: React.PointerEvent) => {
    if (!draggingNodeRef.current) return
    const pos = clientToScene(e.clientX, e.clientY)
    queuedNodePosRef.current = pos
    if (nodeDragRafRef.current == null) {
      nodeDragRafRef.current = requestAnimationFrame(() => {
        nodeDragRafRef.current = null
        drainQueue()
        applyNodeDragDOM()
      })
    }
    // Start throttled store flush so connections update during drag (~7fps)
    if (nodeDragFlushTimer.current == null) {
      nodeDragFlushTimer.current = setInterval(flushNodeDrag, 150)
    }
  }, [clientToScene, applyNodeDragDOM, drainQueue, flushNodeDrag])

  const handleNodeDragEnd = useCallback(() => {
    // Stop throttled flush
    if (nodeDragFlushTimer.current != null) {
      clearInterval(nodeDragFlushTimer.current)
      nodeDragFlushTimer.current = null
    }
    // Cancel any pending RAF
    if (nodeDragRafRef.current != null) {
      cancelAnimationFrame(nodeDragRafRef.current)
      nodeDragRafRef.current = null
    }
    // Final flush — drainQueue ensures the very last pointer position is included
    flushNodeDrag()
    // Apply snapped positions directly to the DOM.  React's reconciler may skip
    // the update when the snapped value hasn't changed since the last throttled
    // flush, leaving the DOM at the unsnapped pointer position.
    const gs = useHybridZoomStore.getState().gridSnap
    for (const [nodeId, pos] of pendingNodePosRef.current) {
      const el =
        (document.querySelector(`[data-node-wrapper="${CSS.escape(nodeId)}"]`) as HTMLElement) ??
        (document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement)
      if (el) {
        el.style.left = `${snapToGrid(pos.x, gs)}%`
        el.style.top = `${snapToGrid(pos.y, gs)}%`
      }
    }
    pendingNodePosRef.current.clear()
    queuedNodePosRef.current = null
    draggingNodeRef.current = null
    multiDragOffsetsRef.current.clear()
    setDraggingNodeId(null)
  }, [flushNodeDrag])

  // ---- Node resize (edge/corner drag) ----
  const handleResizeDragStart = useCallback((nodeId: string, dir: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const node = nodeMap.get(nodeId)
    if (!node || node.locked) return
    const article = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
    if (!article) return
    const el = (article.parentElement?.style.position === 'absolute' || article.parentElement?.style.position === 'fixed')
      ? article.parentElement : article
    beginEditNode(frameModelId) // snapshot once for undo before resize
    resizingRef.current = {
      nodeId,
      dir,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origW: el!.offsetWidth,
      origH: el!.offsetHeight,
      origX: node.x,
      origY: node.y,
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [nodeMap, beginEditNode, frameModelId])

  const handleResizeDragMove = useCallback((e: React.PointerEvent) => {
    const r = resizingRef.current
    if (!r) return
    const scale = effectiveScaleRef.current
    const dx = (e.clientX - r.startClientX) / scale
    const dy = (e.clientY - r.startClientY) / scale
    const dir = r.dir
    let newW = r.origW
    let newH = r.origH
    let newX = r.origX
    let newY = r.origY
    // Horizontal resize
    if (dir.includes('e')) {
      newW = Math.max(NODE_MIN_W, r.origW + dx)
    } else if (dir.includes('w')) {
      newW = Math.max(NODE_MIN_W, r.origW - dx)
      // Shift center so the right edge stays put
      newX = r.origX + (r.origW - newW) / 2 / SCENE_W * 100
    }
    // Vertical resize
    if (dir.includes('s')) {
      newH = Math.max(NODE_MIN_H, r.origH + dy)
    } else if (dir.includes('n')) {
      newH = Math.max(NODE_MIN_H, r.origH - dy)
      // Shift center so the bottom edge stays put
      newY = r.origY + (r.origH - newH) / 2 / SCENE_H * 100
    }
    // Store pending values for flush on drag end
    r.pendingW = Math.round(newW)
    r.pendingH = Math.round(newH)
    r.pendingX = newX
    r.pendingY = newY
    // Apply directly to DOM
    const el =
      (document.querySelector(`[data-node-wrapper="${CSS.escape(r.nodeId)}"]`) as HTMLElement) ??
      (document.querySelector(`[data-node-id="${CSS.escape(r.nodeId)}"]`) as HTMLElement)
    if (el) {
      el.style.width = `${Math.round(newW)}px`
      el.style.height = `${Math.round(newH)}px`
      el.style.left = `${newX}%`
      el.style.top = `${newY}%`
    }
  }, [])

  const handleResizeDragEnd = useCallback(() => {
    const r = resizingRef.current
    if (r && r.pendingW != null) {
      updateNodePropsSilent(frameModelId, r.nodeId, {
        nodeWidth: r.pendingW,
        nodeHeight: r.pendingH,
        x: r.pendingX!,
        y: r.pendingY!,
      })
    }
    resizingRef.current = null
  }, [frameModelId, updateNodePropsSilent])

  // ---- Connection creation (right-click drag) ----
  const handleConnectionDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const node = nodeMap.get(nodeId)
    if (!node) return
    setConnectionDraft({
      fromId: nodeId,
      fromX: node.x,
      fromY: node.y,
      toX: node.x,
      toY: node.y,
      connectionType: activeConnectionType,
    })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [nodeMap]) // eslint-disable-line react-hooks/exhaustive-deps

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
      addConnection(frameModelId, { from: connectionDraft.fromId, to: target.id, type: activeConnectionType === 'default' ? undefined : activeConnectionType })
    }
    setConnectionDraft(null)
  }, [connectionDraft, clientToScene, model.nodes, frameModelId, addConnection, activeConnectionType])

  return {
    clientToScene,
    draggingNodeRef,
    draggingNodeId,
    multiDragOffsetsRef,
    resizingRef,
    selectionRect,
    setSelectionRect,
    selectedNodeIds,
    setSelectedNodeIds,
    selectionStartRef,
    justFinishedSelectionRef,
    clipboardRef,
    lastPasteRef,
    connectionDraft,
    setConnectionDraft,
    activeConnectionType,
    setActiveConnectionType,
    handleNodeDragStart,
    handleNodeDragMove,
    handleNodeDragEnd,
    handleResizeDragStart,
    handleResizeDragMove,
    handleResizeDragEnd,
    handleConnectionDragStart,
    handleConnectionDragMove,
    handleConnectionDragEnd,
  }
}
