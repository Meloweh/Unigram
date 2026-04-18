import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Model } from '../model/sampleModels'
import { SCENE_W, SCENE_H, SCENE_VP, computeGridExtent } from '../scene/sceneConstants'
import { ModelSceneContent } from '../scene/ModelSceneContent'
import { UnzipPopup } from '../ui/UnzipPopup'
import { snapToGrid, useHybridZoomStore, type UnzipPopupState } from '../model/useHybridZoomStore'
import { useShallow } from 'zustand/react/shallow'
import { MpdDial } from '../mpd/MpdDial'
import { LeftSidebar } from '../ui/LeftSidebar'
import { RightSidebar } from '../ui/RightSidebar'
import { loadModel, loadModelById } from '../model/modelLoader'
import { applyThemeToDOM, getTopicalPreset, resolvePalette } from '../theme/themes'
import { resolveBackground, type BackgroundConfig } from '../theme/backgrounds'
import { ParticleOverlay } from '../theme/ParticleOverlay'
import { ContentEditor } from '../ui/ContentEditor'
import { gridBackgroundImage } from '../scene/gridBackground'

import { useFlowEngine } from '../flow/useFlowEngine'
import { useCosmeticAnimations } from '../flow/useCosmeticAnimations'
import { handleDragOver as onDragOver, handleDrop as onDrop, type DropHandlerDeps } from './viewportDropHandler'
import { useViewportKeyboard } from './useViewportKeyboard'
import { handleSave as doSave, handleLoad as doLoad } from './projectIO'
import { useAutoUntangle } from './useAutoUntangle'
import { useUnzipAnim } from '../ui/useUnzipAnim'
import { useViewportDrag } from './useViewportDrag'
import { hitTestPixiNode } from '../scene/PixiNodeRenderer'
import { setPixiVisibleRect } from '../scene/pixiViewportState'
import { EditorToolbar } from '../ui/EditorToolbar'
import { useMpdLogic } from '../mpd/useMpdLogic'
import { useMpdCurtain } from '../mpd/useMpdCurtain'
import { FlowEffectEditorModal } from '../flow/FlowEffectEditorModal'
import { MpdCurtainScene } from '../mpd/MpdCurtainScene'
import { useFps } from '../ui/useFps'
import { useBenchmark } from '../ui/useBenchmark'
import { PixiScene } from '../scene/PixiScene'

import 'katex/dist/katex.min.css'

export function PrototypeViewport() {
  const [debugOpen, setDebugOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 1920, h: 1080 })
  const vpSizeRef = useRef(vpSize)
  vpSizeRef.current = vpSize
  // Reactive state — re-renders only when these specific fields change (shallow comparison)
  const {
    stack, isDragging, isPaused, unzipPopup,
    models: storeModels, gridSnap, appThemeMode, modelCosmetics,
    undoStacks, redoStacks,
  } = useHybridZoomStore(useShallow(s => ({
    stack: s.stack,
    isDragging: s.isDragging,
    isPaused: s.isPaused,
    unzipPopup: s.unzipPopup,
    models: s.models,
    gridSnap: s.gridSnap,
    appThemeMode: s.appThemeMode,
    modelCosmetics: s.modelCosmetics,
    undoStacks: s.undoStacks,
    redoStacks: s.redoStacks,
  })))

  // Derived getters & action functions — stable references, never trigger re-renders
  const {
    currentFrame, getModel: storeGetModel,
    selectNode, clearSelection, zoomIn, zoomOut, pushModel,
    openUnzip, closeUnzip, pause, beginDrag, endDrag,
    panBy, adjustFreeScale, setFreeScale, setPanOffset,
    moveNode, moveNodes, beginMoveNode, beginEditNode,
    addNode, updateNodeLabel, updateNodeShape, updateNodeProps,
    updateNodePropsSilent, setNodeLabelSilent, removeNode,
    addConnection, addNodeBatch, updateConnectionType, updateConnectionProps,
    undo, redo, switchFrameMpd, switchNodeMpd,
    clearLastChildModelId, setLastChildModelId,
    registerModel, updateModelLabel, resetToRoot,
    setGridSnap, updateConnectionEvidence, removeConnection,
    setAppThemeMode, setModelCosmetics,
  } = useHybridZoomStore.getState()

  const frame = currentFrame()
  const model = storeGetModel(frame.modelId)!
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const panOffsetRef = useRef(frame.panOffset)
  panOffsetRef.current = frame.panOffset
  const freeScaleRef = useRef(frame.freeScale)
  freeScaleRef.current = frame.freeScale

  // RAF-throttled panning — coalesces pointer moves to one store update per frame
  const panRafRef = useRef<number | null>(null)
  const queuedPanRef = useRef({ dx: 0, dy: 0 })
  const rafPanBy = useCallback((dx: number, dy: number) => {
    queuedPanRef.current.dx += dx
    queuedPanRef.current.dy += dy
    if (panRafRef.current == null) {
      panRafRef.current = requestAnimationFrame(() => {
        const { dx: qdx, dy: qdy } = queuedPanRef.current
        if (qdx !== 0 || qdy !== 0) {
          panBy(qdx, qdy)
          queuedPanRef.current.dx = 0
          queuedPanRef.current.dy = 0
        }
        panRafRef.current = null
      })
    }
  }, [panBy])

  // FPS counter — writes to DOM directly, never triggers re-render
  const fpsSpanRef = useRef<HTMLSpanElement>(null)
  const fpsRef = useFps(fpsSpanRef)

  // Benchmark mode
  const { benchmarkState, startBenchmark, stopBenchmark } = useBenchmark(frame.modelId, addNodeBatch, fpsRef)

  // Apply theme palette to DOM whenever appThemeMode changes
  useEffect(() => {
    applyThemeToDOM(resolvePalette(appThemeMode))
    // Apply/remove topical CSS class on document root
    const topical = getTopicalPreset(appThemeMode)
    const root = document.documentElement
    // Remove all topical theme classes first
    root.classList.forEach((cls) => {
      if (cls.startsWith('theme-')) root.classList.remove(cls)
    })
    if (topical) root.classList.add(topical.cssClass)
  }, [appThemeMode])

  // Resolve per-model cosmetics
  const currentCosmetics = model ? modelCosmetics[model.id] : undefined
  const bgConfig = currentCosmetics?.background
  const bgStyle = bgConfig ? resolveBackground(bgConfig) : undefined
  const particlePresetId = currentCosmetics?.particleEffect ?? null
  const gridConfig = currentCosmetics?.grid



  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setVpSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Load root model from JSON on startup (if not already in store from hardcoded data)
  useEffect(() => {
    if (!storeGetModel('root')) {
      setIsLoading(true)
      loadModel('/models/root.json', registerModel).finally(() => setIsLoading(false))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load child models when a node is selected that has a childModelId not yet in store
  const selectedNode = model?.nodes.find((n) => n.id === frame.selectedNodeId)
  useEffect(() => {
    if (selectedNode?.childModelId && !storeGetModel(selectedNode.childModelId)) {
      loadModelById(selectedNode.childModelId, registerModel)
    }
    // Also pre-load MPD siblings
    if (selectedNode?.mpdIds) {
      for (const id of selectedNode.mpdIds) {
        if (!storeGetModel(id)) loadModelById(id, registerModel)
      }
    }
  }, [selectedNode?.childModelId, selectedNode?.mpdIds]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Find the selected node's child model (prefer lastChildModelId to preserve MPD switch)
  const childModelId = frame.lastChildModelId ?? selectedNode?.childModelId
  const childModel = childModelId ? storeGetModel(childModelId) : undefined

  // MPD dial logic
  const {
    nodeDialIds, liveMpdIds, isNodeLevelMpd, isFrameLevelMpd,
    mpdOptions, mpdActiveIndex,
  } = useMpdLogic({
    frameModelId: frame.modelId,
    frameSelectedNodeId: frame.selectedNodeId,
    frameNodeMpdOriginalModelId: frame.nodeMpdOriginalModelId,
    frameEntryNodeId: frame.entryNodeId,
    selectedNode,
    stack,
    storeModels,
    storeGetModel,
  })

  // Effective camera scale = RMM zoom × free zoom
  const effectiveScale = frame.snapshot.cameraScale * frame.freeScale
  const effectiveScaleRef = useRef(effectiveScale)
  effectiveScaleRef.current = effectiveScale

  // ---- Flow engine ----
  const {
    flowAnimations, emergeAnimations, flowActiveNodes,
    startFlowAnimation, stopFlowAnimation,
    forceCollapseSidebars, hideToolbar,
    editingEffect, setEditingEffect,
    shakeOffset,
    flowRotation,
    selectedNodeIsInFlow,
    alwaysPlayAnimsRef,
    isFlowPlaying,
  } = useFlowEngine({
    model,
    frameModelId: frame.modelId,
    rmmCameraScale: frame.snapshot.cameraScale,
    selectedNodeId: selectedNode?.id ?? null,
    setPanOffset,
    setFreeScale,
    panOffsetRef,
    freeScaleRef,
    updateNodeProps,
    addNode,
    addConnection,
    selectNode,
    currentFrame,
    zoomIn,
    zoomOut,
    switchNodeMpd,
    switchFrameMpd,
    pushModel,
    storeModels,
    stack,
    viewportRef,
    effectiveScaleRef,
    vpSizeRef,
  })

  // Flow rotation ref — synced from hook-managed state, used by sceneStyle
  const flowRotationRef = useRef(0)
  flowRotationRef.current = flowRotation

  // Dynamic grid extent — auto-expands/contracts in GRID_CHUNK increments based on node positions
  const gridExtent = useMemo(() => computeGridExtent(model?.nodes ?? []), [model?.nodes])

  const { sceneStyle, sceneTx, sceneTy, gridPxW, gridPxH } = useMemo(() => {
    // Auto-center: smoothly pan the scene so the selected node tracks toward viewport center.
    // At nodeProgress=0, no centering. At nodeProgress=1, node is centered.
    // centering = (vpCenter − node% × SCENE) × nodeProgress × scale
    let cx = 0
    let cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * effectiveScale
      cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * effectiveScale
    }
    const tx = cx + frame.panOffset.x
    const ty = cy + frame.panOffset.y
    const gridPxW = SCENE_W * gridSnap / 100
    const gridPxH = SCENE_H * gridSnap / 100
    const rot = flowRotationRef.current
    const rotateStr = rot !== 0 ? ` rotate(${rot}deg)` : ''
    return {
      sceneStyle: {
        width: SCENE_W,
        height: SCENE_H,
        transform: `translate(${tx}px, ${ty}px) scale(${effectiveScale})${rotateStr}`,
        transformOrigin: `${vpSize.w / 2}px ${vpSize.h / 2}px`,
      },
      sceneTx: tx,
      sceneTy: ty,
      gridPxW,
      gridPxH,
    }
  }, [selectedNode, frame.snapshot.nodeProgress, effectiveScale, frame.panOffset.x, frame.panOffset.y, vpSize.w, vpSize.h, gridSnap, flowRotation])

  // Compute visible scene rectangle (in 0-100% scene coordinates) for viewport culling
  const visibleRect = useMemo(() => {
    const BUFFER = 15 // percentage-point margin on each side
    const minSx = (-vpSize.w / 2 - sceneTx) / effectiveScale + vpSize.w / 2
    const maxSx = (vpSize.w / 2 - sceneTx) / effectiveScale + vpSize.w / 2
    const minSy = (-vpSize.h / 2 - sceneTy) / effectiveScale + vpSize.h / 2
    const maxSy = (vpSize.h / 2 - sceneTy) / effectiveScale + vpSize.h / 2
    const rect = {
      minX: minSx / SCENE_W * 100 - BUFFER,
      maxX: maxSx / SCENE_W * 100 + BUFFER,
      minY: minSy / SCENE_H * 100 - BUFFER,
      maxY: maxSy / SCENE_H * 100 + BUFFER,
    }
    // Write to module-level state for PixiJS ticker culling
    setPixiVisibleRect(rect)
    return rect
  }, [sceneTx, sceneTy, effectiveScale, vpSize.w, vpSize.h])

  // At handoff, push into child model (prefer lastChildModelId to preserve MPD switch)
  useEffect(() => {
    if (isChild && selectedNode?.childModelId) {
      pushModel(frame.lastChildModelId ?? selectedNode.childModelId, selectedNode.id)
    }
  }, [isChild, selectedNode?.childModelId, selectedNode?.id, frame.lastChildModelId, pushModel])

  // Compute the centering offset currently applied for the selected node
  // so we can bake it into panOffset when switching nodes (prevents visual jump)
  const handleSelectNode = useCallback((nodeId: string) => {
    const { currentFrame, getModel } = useHybridZoomStore.getState()
    const f = currentFrame()
    const m = getModel(f.modelId)
    const selNode = f.selectedNodeId ? m?.nodes.find(n => n.id === f.selectedNodeId) : undefined
    if (selNode && f.snapshot.nodeProgress > 0) {
      const np = f.snapshot.nodeProgress
      const cs = effectiveScaleRef.current
      const vp = vpSizeRef.current
      const residual = {
        x: (vp.w / 2 - selNode.x / 100 * SCENE_W) * np * cs,
        y: (vp.h / 2 - selNode.y / 100 * SCENE_H) * np * cs,
      }
      selectNode(nodeId, residual)
    } else {
      selectNode(nodeId)
    }
  }, [selectNode])

  // ---- Drag, resize, selection, connection hooks ----
  const {
    clientToScene, draggingNodeRef, draggingNodeId, multiDragOffsetsRef,
    resizingRef, selectionRect, setSelectionRect, selectedNodeIds, setSelectedNodeIds,
    selectionStartRef, justFinishedSelectionRef, clipboardRef,
    connectionDraft, setConnectionDraft, activeConnectionType, setActiveConnectionType,
    handleNodeDragStart, handleNodeDragMove, handleNodeDragEnd,
    handleResizeDragStart, handleResizeDragMove, handleResizeDragEnd,
    handleConnectionDragStart, handleConnectionDragMove, handleConnectionDragEnd,
  } = useViewportDrag({
    model,
    frameModelId: frame.modelId,
    frameSelectedNodeId: frame.selectedNodeId,
    frameFreeScale: frame.freeScale,
    framePanOffset: frame.panOffset,
    frameSnapshotNodeProgress: frame.snapshot.nodeProgress,
    frameSnapshotCameraScale: frame.snapshot.cameraScale,
    viewportRef,
    effectiveScale,
    effectiveScaleRef,
    selectedNode,
    vpSize,
    beginMoveNode,
    beginEditNode,
    moveNode,
    moveNodes,
    updateNodePropsSilent,
    addConnection,
    setFreeScale,
    setPanOffset,
  })

  // MPD curtain transition
  const { mpdCurtain, particleContainerRef, liveNodeSizesRef, handleMpdSelect } = useMpdCurtain({
    model,
    frameModelId: frame.modelId,
    frameSelectedNodeId: frame.selectedNodeId,
    frameNodeMpdOriginalModelId: frame.nodeMpdOriginalModelId,
    framePanOffset: frame.panOffset,
    frameSnapshotNodeProgress: frame.snapshot.nodeProgress,
    effectiveScale,
    selectedNode,
    vpSize,
    sceneStyle,
    bgStyle,
    bgConfig,
    gridExtent,
    gridConfig,
    gridPxW,
    gridPxH,
    mpdOptions,
    isNodeLevelMpd,
    nodeDialIds,
    storeGetModel,
    switchNodeMpd,
    switchFrameMpd,
  })

  // ---- Node creation (double-click on empty space) ----
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingContentNodeId, setEditingContentNodeId] = useState<string | null>(null)

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Check if a PixiJS node was double-clicked
    const scenePos = clientToScene(e.clientX, e.clientY)
    const pixiHitId = hitTestPixiNode(scenePos.x / 100 * SCENE_W, scenePos.y / 100 * SCENE_H)
    if (pixiHitId) {
      const { currentFrame, getModel, beginEditNode: beginEdit } = useHybridZoomStore.getState()
      const f = currentFrame()
      const m = getModel(f.modelId)
      const n = m?.nodes.find(nd => nd.id === pixiHitId)
      if (n && (n.mediaType === 'markdown' || n.mediaType === 'math')) {
        setEditingContentNodeId(pixiHitId)
      } else {
        beginEdit(f.modelId)
        setEditingNodeId(pixiHitId)
      }
      return
    }
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

  useCosmeticAnimations(model, alwaysPlayAnimsRef)

  const handleDragOver = useCallback((e: React.DragEvent) => onDragOver(e), [])

  const dropDeps = useMemo((): DropHandlerDeps => ({
    model, frameModelId: frame.modelId, addNode, selectNode,
    updateNodeProps, clientToScene, setEditingNodeId,
    setEditingContentNodeId, endDrag, lastPointer,
  }), [model, frame.modelId, addNode, selectNode, updateNodeProps, clientToScene, endDrag])

  const handleDrop = useCallback((e: React.DragEvent) => onDrop(e, dropDeps), [dropDeps])

  useViewportKeyboard({
    frameSelectedNodeId: frame.selectedNodeId,
    frameModelId: frame.modelId,
    editingNodeId,
    modelNodes: model.nodes,
    modelConnections: model.connections,
    selectedNodeIds,
    setSelectedNodeIds,
    removeNode,
    removeConnection,
    clearSelection,
    closeUnzip,
    undo,
    redo,
    beginEditNode,
    addNode,
    addConnection,
    unzipPopup,
    setEditingNodeId,
    clipboardRef,
  })

  const handleSave = useCallback(async () => {
    await doSave(storeModels, modelCosmetics, appThemeMode)
  }, [storeModels, modelCosmetics, appThemeMode])

  const handleLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    doLoad(e, { registerModel, resetToRoot, setAppThemeMode, setModelCosmetics })
  }, [registerModel, resetToRoot, setAppThemeMode, setModelCosmetics])

  // ---- Auto-untangle animation ----
  const { isUntangling, setIsUntangling, untangleRaf, handleUntangle } = useAutoUntangle(
    model, frame.modelId, gridSnap, beginMoveNode, moveNodes,
  )

  // ---- Stable callbacks for ModelSceneContent (avoid new references on every render) ----
  const handleDoubleClickNode = useCallback((nodeId: string) => {
    const { currentFrame, getModel, beginEditNode: beginEdit } = useHybridZoomStore.getState()
    const f = currentFrame()
    const m = getModel(f.modelId)
    const n = m?.nodes.find(nd => nd.id === nodeId)
    if (n && (n.mediaType === 'markdown' || n.mediaType === 'math')) {
      setEditingContentNodeId(nodeId)
    } else {
      beginEdit(f.modelId)
      setEditingNodeId(nodeId)
    }
  }, [])

  const handleClickConnection = useCallback((key: string, ax: number, ay: number) => {
    setSelectedNodeIds(new Set())
    openUnzip(key, ax, ay)
  }, [setSelectedNodeIds, openUnzip])

  const handleNodeSizesChanged = useCallback((sizes: Map<string, { w: number; h: number }>) => {
    liveNodeSizesRef.current = sizes
  }, [])

  const handleFinishEditing = useCallback((nodeId: string, label: string) => {
    const { currentFrame } = useHybridZoomStore.getState()
    const f = currentFrame()
    if (label.trim()) {
      setNodeLabelSilent(f.modelId, nodeId, label.trim())
    } else {
      removeNode(f.modelId, nodeId)
    }
    setEditingNodeId(null)
  }, [setNodeLabelSilent, removeNode])

  const handleLiveEditLabel = useCallback((nodeId: string, label: string) => {
    const { currentFrame } = useHybridZoomStore.getState()
    const f = currentFrame()
    setNodeLabelSilent(f.modelId, nodeId, label)
  }, [setNodeLabelSilent])

  return (
    <div
      ref={viewportRef}
      className={`viewport ${isDragging ? 'dragging' : ''}${selectionRect ? ' select-mode' : ''}`}
      style={bgConfig?.type !== 'image' ? bgStyle : undefined}
      onWheel={(event) => {
        event.preventDefault()
        // Cancel any running untangle animation before zooming
        if (isUntangling) {
          cancelAnimationFrame(untangleRaf.current)
          setIsUntangling(false)
        }
        const zoomingIn = event.deltaY < 0
        const hasSelection = !!frame.selectedNodeId
        const canRmmIn = selectedNode && selectedNode.childModelId
        const canRmmOut = stack.length > 1 || frame.snapshot.progress > 0

        if (hasSelection) {
          // With a selection: use default RMM zoom only, no free zoom
          if (zoomingIn) {
            zoomIn()
          } else {
            zoomOut()
          }
        } else {
          // Free zoom — anchor to cursor position
          const doFreeZoom = zoomingIn || frame.freeScale > 1 || !canRmmOut
          if (!doFreeZoom) {
            zoomOut()
          } else {
            const rect = viewportRef.current?.getBoundingClientRect()
            if (rect) {
              // Cursor position relative to viewport center
              const cx = event.clientX - rect.left - rect.width / 2
              const cy = event.clientY - rect.top - rect.height / 2
              const oldScale = effectiveScale
              const factor = zoomingIn ? 1.08 : 1 / 1.08
              const newFreeScale = Math.min(5, Math.max(0.2, frame.freeScale * factor))
              const newScale = frame.snapshot.cameraScale * newFreeScale
              // Adjust pan so the scene point under the cursor stays fixed
              const newPanX = cx - (cx - frame.panOffset.x) * newScale / oldScale
              const newPanY = cy - (cy - frame.panOffset.y) * newScale / oldScale
              setFreeScale(newFreeScale)
              setPanOffset(newPanX, newPanY)
            } else {
              adjustFreeScale(zoomingIn ? 1 : -1)
            }
          }
        }
      }}
      onPointerDown={(event) => {
        const el = event.target as HTMLElement
        if (el.closest('.sidebar') || el.closest('.editor-toolbar')) return

        // PixiJS node hit-test (replaces 500 DOM hit-area divs)
        const scenePos = clientToScene(event.clientX, event.clientY)
        const pixiHitId = hitTestPixiNode(scenePos.x / 100 * SCENE_W, scenePos.y / 100 * SCENE_H)

        // Right-click on a PixiJS node → connection drag
        if (event.button === 2 && pixiHitId && !draggingNodeRef.current && !connectionDraft) {
          event.preventDefault()
          handleConnectionDragStart(pixiHitId, event)
          return
        }
        // Right-click on empty space: start selection rectangle
        if (event.button === 2 && !draggingNodeRef.current && !connectionDraft) {
          if (!el.closest('.host-node')) {
            event.preventDefault()
            selectionStartRef.current = { clientX: event.clientX, clientY: event.clientY }
            const pos = clientToScene(event.clientX, event.clientY)
            setSelectionRect({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y })
            return
          }
        }
        if (event.button !== 0) return

        // Left-click on a PixiJS node → node drag
        if (pixiHitId && editingNodeId !== pixiHitId) {
          handleNodeDragStart(pixiHitId, event)
          return
        }

        beginDrag()
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerMove={(event) => {
        // Node resize takes highest priority
        if (resizingRef.current) {
          handleResizeDragMove(event)
          return
        }
        // Selection rectangle dragging
        if (selectionStartRef.current) {
          const pos = clientToScene(event.clientX, event.clientY)
          setSelectionRect((r) => r ? { ...r, endX: pos.x, endY: pos.y } : null)
          return
        }
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
        rafPanBy(dx, dy)
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        // Finish resize
        if (resizingRef.current) {
          handleResizeDragEnd()
          return
        }
        // Finish selection rectangle
        if (selectionStartRef.current && selectionRect) {
          selectionStartRef.current = null
          const minX = Math.min(selectionRect.startX, selectionRect.endX)
          const maxX = Math.max(selectionRect.startX, selectionRect.endX)
          const minY = Math.min(selectionRect.startY, selectionRect.endY)
          const maxY = Math.max(selectionRect.startY, selectionRect.endY)
          const ids = new Set<string>()
          for (const node of model.nodes) {
            if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
              ids.add(node.id)
            }
          }
          setSelectedNodeIds(ids)
          setSelectionRect(null)
          justFinishedSelectionRef.current = true
          return
        }
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
        if (resizingRef.current) handleResizeDragEnd()
        if (selectionStartRef.current) {
          selectionStartRef.current = null
          setSelectionRect(null)
        }
        handleNodeDragEnd()
        setConnectionDraft(null)
        endDrag()
        lastPointer.current = null
      }}
      onClick={(event) => {
        if (justFinishedSelectionRef.current) {
          justFinishedSelectionRef.current = false
          return
        }
        // PixiJS node hit-test for selection
        const scenePos = clientToScene(event.clientX, event.clientY)
        const pixiHitId = hitTestPixiNode(scenePos.x / 100 * SCENE_W, scenePos.y / 100 * SCENE_H)
        if (pixiHitId) {
          handleSelectNode(pixiHitId)
          setSelectedNodeIds(new Set())
          return
        }
        // Deselect when clicking empty space — anything that isn't a node or interactive child
        const el = event.target as HTMLElement
        if (!el.closest('.host-node') && !el.closest('.connection-line') && !el.closest('.unzip-popup') && !el.closest('.sidebar') && !el.closest('.editor-toolbar')) {
          clearSelection()
          setSelectedNodeIds(new Set())
          closeUnzip()
        }
      }}
      onDoubleClick={handleDoubleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Image background layer */}
      {bgConfig?.type === 'image' && bgConfig.value && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            backgroundImage: `url(${bgConfig.value})`,
            backgroundSize: bgConfig.fit === 'tile' ? 'auto' : (bgConfig.fit ?? 'cover'),
            backgroundPosition: 'center',
            backgroundRepeat: bgConfig.fit === 'tile' ? 'repeat' : 'no-repeat',
            opacity: bgConfig.opacity ?? 1,
            filter: bgConfig.blur ? `blur(${bgConfig.blur}px)` : undefined,
            pointerEvents: 'none',
            clipPath: mpdCurtain
              ? mpdCurtain.direction === 'left'
                ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
                : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`
              : 'inset(0)',
          }}
        />
      )}

      {/* Ambient particle overlay — clipped to new side during curtain */}
      <div
        ref={particleContainerRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          clipPath: mpdCurtain
            ? mpdCurtain.direction === 'left'
              ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
              : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`
            : 'inset(0)',
        }}
      >
        {particlePresetId && (
          <ParticleOverlay
            presetId={particlePresetId}
            sceneTx={sceneTx}
            sceneTy={sceneTy}
            sceneScale={effectiveScale}
            vpSize={SCENE_VP}
            gridExtent={gridExtent}
          />
        )}
      </div>

      <div className="debug-overlay">
        <div className="prototype-stats compact">
          <span ref={fpsSpanRef} style={{ color: '#4caf50' }}>
            FPS: --
          </span>
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
            <span>Camera: {effectiveScale.toFixed(2)}</span>
            <span>Inflation: {frame.snapshot.nodeInflation.toFixed(2)}</span>
            <span>Paused: {isPaused ? 'yes' : 'no'}</span>
            <span>Nodes: {model.nodes.length} | Connections: {model.connections.length}</span>
            <button
              type="button"
              onClick={benchmarkState.isRunning ? stopBenchmark : startBenchmark}
              style={{ marginLeft: 8 }}
            >
              {benchmarkState.isRunning ? 'Stop Benchmark' : 'Start Benchmark'}
            </button>
            {benchmarkState.isRunning && (
              <span>
                Bench: {benchmarkState.nodeCount} nodes, {benchmarkState.connectionCount} conns
              </span>
            )}
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
          onSelect={handleMpdSelect}
        />
      )}

      <EditorToolbar
        hideToolbar={hideToolbar}
        undoDisabled={!(undoStacks[frame.modelId]?.length)}
        redoDisabled={!(redoStacks[frame.modelId]?.length)}
        deleteDisabled={!frame.selectedNodeId}
        isUntangling={isUntangling}
        selectedNodeIsInFlow={selectedNodeIsInFlow}
        isFlowPlaying={isFlowPlaying}
        onUndo={() => undo(frame.modelId)}
        onRedo={() => redo(frame.modelId)}
        onDelete={() => { if (frame.selectedNodeId) { removeNode(frame.modelId, frame.selectedNodeId); clearSelection() } }}
        onUntangle={handleUntangle}
        onStartFlow={() => selectedNode && startFlowAnimation(selectedNode.id)}
        onStopFlow={stopFlowAnimation}
        onSave={handleSave}
        onLoad={handleLoad}
      />

      {/* During MPD curtain: render old model in a clip wrapper (no transform → viewport coords) */}
      {mpdCurtain && <MpdCurtainScene curtain={mpdCurtain} />}

      {/* New/live scene – clip wrapper sits outside the transform so clip is in viewport coords */}
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: mpdCurtain
          ? mpdCurtain.direction === 'left'
            ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
            : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`
          : 'inset(0)',
      }}>
      {/* PixiJS scene — behind DOM scene, inside clip wrapper so MPD curtain clips it */}
      <PixiScene
        sceneTx={sceneTx}
        sceneTy={sceneTy}
        effectiveScale={effectiveScale}
        rotation={flowRotation}
        vpSize={vpSize}
      />

      {/* During curtain: new background inside clip wrapper */}
      {mpdCurtain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            ...(bgConfig?.type === 'image' && bgConfig.value
              ? {
                  backgroundImage: `url(${bgConfig.value})`,
                  backgroundSize: bgConfig.fit === 'tile' ? 'auto' : (bgConfig.fit ?? 'cover'),
                  backgroundPosition: 'center',
                  backgroundRepeat: bgConfig.fit === 'tile' ? 'repeat' : 'no-repeat',
                  opacity: bgConfig.opacity ?? 1,
                  filter: bgConfig.blur ? `blur(${bgConfig.blur}px)` : undefined,
                }
              : bgStyle
                ? bgStyle
                : { background: 'var(--ug-viewport-bg)' }),
          }}
        />
      )}
      <div
        className="scene"
        style={{
          ...sceneStyle,
          ...(shakeOffset.x !== 0 || shakeOffset.y !== 0
            ? { marginLeft: shakeOffset.x, marginTop: shakeOffset.y }
            : {}),
        }}
      >
        {/* Dynamic grid — auto-extends with node positions */}
        <div style={{
          position: 'absolute',
          left: `${gridExtent.minX}%`,
          top: `${gridExtent.minY}%`,
          width: `${gridExtent.maxX - gridExtent.minX}%`,
          height: `${gridExtent.maxY - gridExtent.minY}%`,
          backgroundImage: gridBackgroundImage(gridConfig),
          backgroundSize: `${gridPxW}px ${gridPxH}px`,
          pointerEvents: 'none',
        }} />
        <ModelSceneContent
          model={model}
          selectedNodeId={frame.selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          childModel={childModel}
          progress={p}
          vpSize={SCENE_VP}
          visibleRect={visibleRect}
          effectiveScale={effectiveScale}
          onSelectNode={handleSelectNode}
          onDoubleClickNode={handleDoubleClickNode}
          onClickConnection={handleClickConnection}
          onNodeDragStart={handleNodeDragStart}
          onConnectionDragStart={handleConnectionDragStart}
          draggingNodeId={draggingNodeId}
          draggingMultiIds={multiDragOffsetsRef.current.size > 0 ? selectedNodeIds : undefined}
          editingNodeId={editingNodeId}
          noTransition={!!mpdCurtain || isDragging}
          onNodeSizesChanged={handleNodeSizesChanged}
          onFinishEditing={handleFinishEditing}
          onLiveEditLabel={handleLiveEditLabel}
          connectionDraft={connectionDraft}
          flowAnimations={flowAnimations}
          emergeAnimations={emergeAnimations}
          flowActiveNodes={flowActiveNodes}
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
              return Math.atan2((tn.y - fn.y) * SCENE_H, (tn.x - fn.x) * SCENE_W)
            })()
          } : null}
          onSetMedia={(nodeId, src, name) => {
            beginEditNode(frame.modelId)
            updateNodeProps(frame.modelId, nodeId, { mediaSrc: src, mediaFileName: name })
            // Auto-size to media natural dimensions
            const node = model.nodes.find(n => n.id === nodeId)
            const mt = node?.mediaType
            if (mt === 'image' || mt === 'gif') {
              const img = new Image()
              img.onload = () => {
                const maxW = 400, maxH = 400
                let w = img.naturalWidth, h = img.naturalHeight
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h)
                  w = Math.round(w * ratio)
                  h = Math.round(h * ratio)
                }
                w = Math.max(w, 60)
                h = Math.max(h, 40)
                updateNodeProps(frame.modelId, nodeId, { nodeWidth: w, nodeHeight: h })
              }
              img.src = src
            } else if (mt === 'video') {
              const vid = document.createElement('video')
              vid.onloadedmetadata = () => {
                const maxW = 400, maxH = 400
                let w = vid.videoWidth, h = vid.videoHeight
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h)
                  w = Math.round(w * ratio)
                  h = Math.round(h * ratio)
                }
                w = Math.max(w, 100)
                h = Math.max(h, 80)
                updateNodeProps(frame.modelId, nodeId, { nodeWidth: w, nodeHeight: h })
              }
              vid.src = src
            }
          }}
          onToggleCollapse={(nodeId) => {
            const n = model.nodes.find(nd => nd.id === nodeId)
            if (!n) return
            const nowCollapsed = !(n.contentCollapsed !== false)
            updateNodeProps(frame.modelId, nodeId, { contentCollapsed: nowCollapsed })
            // Auto-resize: expand to fit content, collapse to compact
            if (!nowCollapsed) {
              // Expanding — use a larger default height
              const expandedH = Math.max(n.nodeHeight ?? 60, 160)
              updateNodeProps(frame.modelId, nodeId, { nodeHeight: expandedH })
            } else {
              // Collapsing — shrink back to compact
              updateNodeProps(frame.modelId, nodeId, { nodeHeight: 60 })
            }
          }}
          onResizeDragStart={handleResizeDragStart}
          onTipDrag={(nodeId, tipAngle, tipLength) => {
            updateNodeProps(frame.modelId, nodeId, { tipAngle, tipLength })
          }}
        />
        {activeUnzipPopup && (() => {
          const conn = model.connections.find(
            (c) => `${c.from}->${c.to}` === activeUnzipPopup.connectionKey,
          )
          if (!conn) return null
          const fromNode = model.nodes.find((n) => n.id === conn.from)
          const toNode = model.nodes.find((n) => n.id === conn.to)
          const angle = fromNode && toNode
            ? Math.atan2(
                (toNode.y - fromNode.y) * SCENE_H,
                (toNode.x - fromNode.x) * SCENE_W,
              )
            : 0
          return (
            <UnzipPopup
              connectionKey={activeUnzipPopup.connectionKey}
              level={activeUnzipPopup.level}
              evidence={conn.evidence ?? []}
              anchorX={activeUnzipPopup.anchorX}
              anchorY={activeUnzipPopup.anchorY}
              animProgress={unzipAnimProgress}
              connectionAngle={angle}
              onSizeChange={handlePopupSizeChange}
              onUpdateEvidence={(evidence) => {
                updateConnectionEvidence(frame.modelId, conn.from, conn.to, evidence)
              }}
            />
          )
        })()}
      </div>
      </div>

      {mpdCurtain && (
        <div
          className="mpd-curtain-line"
          style={{
            left: mpdCurtain.direction === 'left'
              ? `${(1 - mpdCurtain.progress) * 100}%`
              : `${mpdCurtain.progress * 100}%`,
          }}
        />
      )}

      {selectionRect && (() => {
        const rect = viewportRef.current?.getBoundingClientRect()
        if (!rect) return null
        const cs = effectiveScale
        let cx = 0, cy = 0
        if (selectedNode) {
          const np = frame.snapshot.nodeProgress
          cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs
          cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs
        }
        const toScreen = (pctX: number, pctY: number) => ({
          x: ((pctX / 100) * SCENE_W - rect.width / 2) * cs + rect.width / 2 + cx + frame.panOffset.x,
          y: ((pctY / 100) * SCENE_H - rect.height / 2) * cs + rect.height / 2 + cy + frame.panOffset.y,
        })
        const s = toScreen(selectionRect.startX, selectionRect.startY)
        const e = toScreen(selectionRect.endX, selectionRect.endY)
        const left = Math.min(s.x, e.x)
        const top = Math.min(s.y, e.y)
        const width = Math.abs(e.x - s.x)
        const height = Math.abs(e.y - s.y)
        return (
          <div
            className="selection-rect"
            style={{ left, top, width, height }}
          />
        )
      })()}

      <LeftSidebar connectionType={activeConnectionType} onConnectionTypeChange={setActiveConnectionType} forceCollapsed={forceCollapseSidebars} />
      <RightSidebar
        model={model}
        selectedNode={selectedNode}
        selectedNodeIds={selectedNodeIds}
        selectedConnection={selectedNode ? undefined : (unzipPopup
          ? model?.connections.find(c => `${c.from}->${c.to}` === unzipPopup.connectionKey)
          : undefined
        )}
        gridSnap={gridSnap}
        onSetGridSnap={setGridSnap}
        onUpdateNodeShape={(nodeId, shape) => updateNodeShape(frame.modelId, nodeId, shape)}
        onUpdateNodeProps={(nodeId, props) => updateNodeProps(frame.modelId, nodeId, props)}
        onBulkUpdateNodeProps={(nodeIds, props) => {
          for (const id of nodeIds) updateNodeProps(frame.modelId, id, props)
        }}
        onBulkUpdateNodeShape={(nodeIds, shape) => {
          for (const id of nodeIds) updateNodeShape(frame.modelId, id, shape)
        }}
        allModels={storeModels}
        onRegisterModel={registerModel}
        onUpdateModelLabel={updateModelLabel}
        onUpdateConnectionType={(from, to, type) => updateConnectionType(frame.modelId, from, to, type)}
        onUpdateConnectionProps={(from, to, props) => updateConnectionProps(frame.modelId, from, to, props)}
        onEditEffect={(nodeId, effectId) => setEditingEffect({ nodeId, effectId })}
        onEditContent={(nodeId) => setEditingContentNodeId(nodeId)}
        forceCollapsed={forceCollapseSidebars}
      />

      {/* Flow effect graph editor modal */}
      {editingEffect && (
        <FlowEffectEditorModal
          editingEffect={editingEffect}
          model={model}
          frameModelId={frame.modelId}
          stackLength={stack.length}
          storeModels={storeModels}
          updateNodeProps={updateNodeProps}
          onClose={() => setEditingEffect(null)}
        />
      )}
      {/* Content editor popup for markdown/math nodes */}
      {editingContentNodeId && (() => {
        const editContentNode = model.nodes.find(n => n.id === editingContentNodeId)
        if (!editContentNode || (editContentNode.mediaType !== 'markdown' && editContentNode.mediaType !== 'math')) return null
        return (
          <ContentEditor
            contentType={editContentNode.mediaType as 'markdown' | 'math'}
            source={editContentNode.contentSource ?? ''}
            onSave={(source) => {
              updateNodeProps(frame.modelId, editingContentNodeId, { contentSource: source })
              setEditingContentNodeId(null)
            }}
            onClose={() => setEditingContentNodeId(null)}
          />
        )
      })()}
    </div>
  )
}
