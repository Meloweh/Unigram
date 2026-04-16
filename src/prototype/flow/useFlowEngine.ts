import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { Model, ModelNode, ModelConnection } from '../model/sampleModels'
import type { FlowTask, FlowDAG, FlowEffectCtx } from './flowTypes'
import { dispatchEffect } from './flowEffectHandlers'
import { audioCtxCache, SCENE_W, SCENE_H } from '../scene/sceneConstants'

export interface FlowEngineDeps {
  model: Model
  frameModelId: string
  rmmCameraScale: number
  selectedNodeId: string | null
  setPanOffset: (x: number, y: number) => void
  setFreeScale: (s: number) => void
  panOffsetRef: React.RefObject<{ x: number; y: number }>
  freeScaleRef: React.RefObject<number>
  updateNodeProps: (modelId: string, nodeId: string, props: Partial<ModelNode>) => void
  addNode: (modelId: string, node: Partial<ModelNode>) => void
  addConnection: (modelId: string, conn: Partial<ModelConnection>) => void
  selectNode: (nodeId: string) => void
  currentFrame: () => { modelId: string; selectedNodeId: string | null; snapshot: { progress: number; cameraScale: number } }
  zoomIn: () => void
  zoomOut: () => void
  switchNodeMpd: (targetId: string, mpdIds: string[]) => void
  switchFrameMpd: (targetId: string) => void
  pushModel: (modelId: string) => void
  storeModels: Record<string, Model>
  stack: Array<{ modelId: string }>
  viewportRef: React.RefObject<HTMLDivElement | null>
  effectiveScaleRef: React.RefObject<number>
  vpSizeRef: React.RefObject<{ w: number; h: number }>
}

export function useFlowEngine(deps: FlowEngineDeps) {
  const depsRef = useRef(deps)
  depsRef.current = deps

  // ---- Flow animation state ----
  const [flowAnimations, setFlowAnimations] = useState<Map<string, number>>(new Map())
  const [emergeAnimations, setEmergeAnimations] = useState<Map<string, number>>(new Map())
  const [flowActiveNodes, setFlowActiveNodes] = useState<Set<string>>(new Set())
  const flowAnimRef = useRef<number | null>(null)
  const flowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flowMediaDoneRef = useRef(new Set<string>())

  // ---- Flow recording state ----
  const [forceCollapseSidebars, setForceCollapseSidebars] = useState(false)
  const [hideToolbar, setHideToolbar] = useState(false)
  const flowRecorderRef = useRef<MediaRecorder | null>(null)
  const flowRecordChunksRef = useRef<BlobPart[]>([])
  const flowRecordStreamRef = useRef<MediaStream | null>(null)

  // ---- Flow effect editor state ----
  const [editingEffect, setEditingEffect] = useState<{ nodeId: string; effectId: string } | null>(null)

  const flowDAGRef = useRef<FlowDAG | null>(null)

  // Camera tracking state for flow-follow
  const flowCameraRef = useRef<{
    preFlowPan: { x: number; y: number }
    preFlowScale: number
    lastTrackedCenter: { x: number; y: number } | null
    active: boolean
  } | null>(null)

  // Camera effect override (from 'camera' effect node)
  const flowCameraOverrideRef = useRef<{
    panX: number; panY: number; zoom: number; rotation: number
    durationMs: number; startTime: number
    panXDurationMs: number; panYDurationMs: number; zoomDurationMs: number; rotationDurationMs: number
    panXResetMode: string; panYResetMode: string; zoomResetMode: string; rotationResetMode: string
    panXEasing: string; panYEasing: string; zoomEasing: string; rotationEasing: string
    startPan: { x: number; y: number }; startFreeScale: number
  } | null>(null)
  // Smooth fadeout for residual camera effects when override expires
  const flowCameraFadeoutRef = useRef<{
    rotation: number; freeScaleOffset: number; startFreeScale: number
  } | null>(null)
  const [shakeOffset, setShakeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const brokenNodeElementsRef = useRef<HTMLElement[]>([])
  const emergeHiddenElementsRef = useRef<HTMLElement[]>([])
  const scaleRevertTimersRef = useRef<number[]>([])
  const flowColorBackupsRef = useRef<{ el: HTMLElement; bg: string }[]>([])
  const flowTextFormatTimersRef = useRef<number[]>([])
  const flowTextFormatBackupsRef = useRef<{ el: HTMLElement; orig: { fontWeight: string; fontStyle: string; textDecoration: string; color: string; fontSize: string; transition: string } }[]>([])
  const flowTextFormatWrapperBackupsRef = useRef<{ el: HTMLElement; orig: { width: string; minWidth: string; height: string; minHeight: string; transition: string } }[]>([])
  const flowKeepPlayingAnimsRef = useRef<{ rafId: number; cleanup: () => void }[]>([])
  const flowLevitateAnimsRef = useRef<{ rafId: number; cleanup: () => void }[]>([])
  const flowEffectTimersRef = useRef<number[]>([])
  const alwaysPlayAnimsRef = useRef<Map<string, { rafId: number; cleanup: () => void }>>(new Map())

  const [flowRotation, setFlowRotation] = useState(0)
  const flowRotationRef = useRef(flowRotation)
  flowRotationRef.current = flowRotation

  // ---- Inline helpers (not useCallback) ----
  const restoreBrokenNodes = () => {
    for (const el of brokenNodeElementsRef.current) {
      el.style.opacity = ''
    }
    brokenNodeElementsRef.current = []
  }

  const restoreEmergeNodes = () => {
    for (const el of emergeHiddenElementsRef.current) {
      el.style.opacity = ''
      el.style.transform = 'translate(-50%, -50%)'
      el.style.transition = ''
    }
    emergeHiddenElementsRef.current = []
  }

  // ---- stopFlowAnimation ----
  const stopFlowAnimation = useCallback(() => {
    if (flowAnimRef.current != null) cancelAnimationFrame(flowAnimRef.current)
    if (flowTimeoutRef.current != null) clearTimeout(flowTimeoutRef.current)
    flowAnimRef.current = null
    flowTimeoutRef.current = null
    flowCameraOverrideRef.current = null
    flowCameraFadeoutRef.current = null
    // Clear all scheduled effect timeouts (BFS-scheduled, including repeater iterations)
    for (const t of flowEffectTimersRef.current) clearTimeout(t)
    flowEffectTimersRef.current = []
    // Animate camera back to pre-flow position
    const cam = flowCameraRef.current
    if (cam?.active) {
      const startPan = { x: depsRef.current.panOffsetRef.current.x, y: depsRef.current.panOffsetRef.current.y }
      const startScale = depsRef.current.freeScaleRef.current
      const targetPan = cam.preFlowPan
      const targetScale = cam.preFlowScale
      const startTime = performance.now()
      const duration = 500
      const animateBack = (now: number) => {
        const t = Math.min((now - startTime) / duration, 1)
        const ease = 1 - (1 - t) * (1 - t) // ease-out quad
        depsRef.current.setPanOffset(
          startPan.x + (targetPan.x - startPan.x) * ease,
          startPan.y + (targetPan.y - startPan.y) * ease,
        )
        depsRef.current.setFreeScale(startScale + (targetScale - startScale) * ease)
        setFlowRotation(prev => prev * (1 - ease))
        if (t < 1) requestAnimationFrame(animateBack)
      }
      requestAnimationFrame(animateBack)
    } else {
      setFlowRotation(0)
    }
    flowCameraRef.current = null
    flowDAGRef.current = null
    flowMediaDoneRef.current.clear()
    setFlowAnimations(new Map())
    setEmergeAnimations(new Map())
    setFlowActiveNodes(new Set())
    restoreBrokenNodes()
    restoreEmergeNodes()
    for (const t of scaleRevertTimersRef.current) clearTimeout(t)
    scaleRevertTimersRef.current = []
    // Restore colors changed by permanent color effects
    for (const { el, bg } of flowColorBackupsRef.current) {
      el.style.transition = 'background 400ms ease'
      el.style.background = bg
      setTimeout(() => { el.style.transition = '' }, 400)
    }
    flowColorBackupsRef.current = []
    // Restore text formatting applied by text-format effect nodes
    for (const t of flowTextFormatTimersRef.current) clearTimeout(t)
    flowTextFormatTimersRef.current = []
    for (const { el, orig } of flowTextFormatBackupsRef.current) {
      el.style.fontWeight = orig.fontWeight
      el.style.fontStyle = orig.fontStyle
      el.style.textDecoration = orig.textDecoration
      el.style.color = orig.color
      el.style.fontSize = orig.fontSize
      el.style.transition = orig.transition
    }
    flowTextFormatBackupsRef.current = []
    for (const { el, orig } of flowTextFormatWrapperBackupsRef.current) {
      el.style.width = orig.width
      el.style.minWidth = orig.minWidth
      el.style.height = orig.height
      el.style.minHeight = orig.minHeight
      el.style.transition = orig.transition
    }
    flowTextFormatWrapperBackupsRef.current = []
    // Stop keep-playing looping animations (jitter, float, move)
    for (const { rafId, cleanup } of flowKeepPlayingAnimsRef.current) {
      cancelAnimationFrame(rafId)
      cleanup()
    }
    flowKeepPlayingAnimsRef.current = []
    // Stop levitate animations started during flow
    for (const { rafId, cleanup } of flowLevitateAnimsRef.current) {
      cancelAnimationFrame(rafId)
      cleanup()
    }
    flowLevitateAnimsRef.current = []
    // Stop all playing media elements
    document.querySelectorAll('[data-node-id] video, [data-node-id] audio').forEach(el => {
      const media = el as HTMLVideoElement | HTMLAudioElement
      if (!media.paused) media.pause()
    })
    // Stop flow recording and download result
    if (flowRecorderRef.current && flowRecorderRef.current.state !== 'inactive') {
      flowRecorderRef.current.stop()
      // onstop handler will assemble blob, download, and restore UI
    } else {
      // Stop stream tracks if recording never started
      if (flowRecordStreamRef.current) {
        flowRecordStreamRef.current.getTracks().forEach(t => t.stop())
        flowRecordStreamRef.current = null
      }
      setForceCollapseSidebars(false)
      setHideToolbar(false)
      document.documentElement.style.cursor = ''
    }
  }, [])

  const stopFlowAnimationRef = useRef(stopFlowAnimation)
  stopFlowAnimationRef.current = stopFlowAnimation

  // ---- triggerMediaPlay ----
  const triggerMediaPlay = useCallback((nodeId: string) => {
    const article = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
    if (!article) return
    const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
    if (media) {
      const node = depsRef.current.model.nodes.find(n => n.id === nodeId)
      if (node?.playStart != null) media.currentTime = node.playStart
      media.play().catch(() => {})
    }
  }, [])

  // ---- executeNodeEffects ----
  const executeNodeEffects = useCallback((nodeId: string): number => {
    const node = depsRef.current.model.nodes.find(n => n.id === nodeId)
    if (!node) return 100

    // Helper: schedule a flow-effect timeout that gets tracked for cancellation
    const scheduleEffect = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      flowEffectTimersRef.current.push(id)
      return id
    }

    // Collect all effects — include the implicit locked media effect if present
    const effects = node.flowEffects ?? []
    // Also consider implicit media if no locked effect exists
    const hasLockedEffect = effects.some(e => e.locked)
    const hasMedia = !!node.mediaType

    let maxDuration = 0

    // Build effect context for dispatching to extracted handlers
    const ctx: FlowEffectCtx = {
      nodeId,
      node,
      model: depsRef.current.model,
      frameModelId: depsRef.current.frameModelId,
      scheduleEffect,
      cleanup: {
        colorBackups: flowColorBackupsRef.current,
        brokenElements: brokenNodeElementsRef.current,
        emergeHidden: emergeHiddenElementsRef.current,
        scaleTimers: scaleRevertTimersRef.current,
        textFormatTimers: flowTextFormatTimersRef.current,
        textFormatBackups: flowTextFormatBackupsRef.current,
        wrapperBackups: flowTextFormatWrapperBackupsRef.current,
        keepPlayingAnims: flowKeepPlayingAnimsRef.current,
        levitateAnims: flowLevitateAnimsRef.current,
        effectTimers: flowEffectTimersRef.current,
        mediaDone: flowMediaDoneRef.current,
      },
      triggerMediaPlay,
      audioCtxCache,
      flowCameraOverrideRef: flowCameraOverrideRef as React.MutableRefObject<any>,
      flowCameraFadeoutRef: flowCameraFadeoutRef as React.MutableRefObject<any>,
      panOffsetRef: depsRef.current.panOffsetRef,
      freeScaleRef: depsRef.current.freeScaleRef,
      setShakeOffset,
      setEmergeAnimations,
      setForceCollapseSidebars,
      setHideToolbar,
      updateNodeProps: depsRef.current.updateNodeProps,
      addNode: depsRef.current.addNode,
      addConnection: depsRef.current.addConnection,
      selectNode: depsRef.current.selectNode,
      currentFrame: depsRef.current.currentFrame,
      zoomIn: depsRef.current.zoomIn,
      zoomOut: depsRef.current.zoomOut,
      switchNodeMpd: depsRef.current.switchNodeMpd,
      switchFrameMpd: depsRef.current.switchFrameMpd,
      stack: depsRef.current.stack,
      flowRecorderRef,
      flowRecordChunksRef,
      flowRecordStreamRef,
      viewportRef: depsRef.current.viewportRef,
      startFlowAnimationRef,
    }
    for (const effect of effects) {
      const graphNodes = effect.graph.nodes
      const graphEdges = effect.graph.edges
      if (graphNodes.length === 0) continue

      // Build adjacency from graph edges
      const adj = new Map<string, string[]>()
      for (const e of graphEdges) {
        if (!adj.has(e.from)) adj.set(e.from, [])
        adj.get(e.from)!.push(e.to)
      }

      // BFS from entry node(s), executing effects layer by layer
      const entryNodes = graphNodes.filter(n => n.kind === 'entry')
      if (entryNodes.length === 0) continue

      let frontier = entryNodes.map(n => n.id)
      const visited = new Set<string>(frontier)
      let totalDelay = 0
      const repeaterCounters = new Map<string, number>()
      let bfsSafety = 0

      while (frontier.length > 0 && bfsSafety++ < 10000) {
        const nextFrontier: string[] = []
        let layerMaxDuration = 0

        for (const gNodeId of frontier) {
          // Determine targets — repeater nodes route based on counter
          let targets: string[]
          const selfNode = graphNodes.find(n => n.id === gNodeId)
          if (selfNode?.kind === 'repeater') {
            const count = (repeaterCounters.get(gNodeId) ?? 0) + 1
            repeaterCounters.set(gNodeId, count)
            const rptCount = (selfNode.config.repeatCount as number) ?? 3
            const outEdges = graphEdges.filter(e => e.from === gNodeId)

            if (count <= rptCount) {
              // Follow circuit edges, clear visited for circuit path nodes
              targets = outEdges.filter(e => e.fromPort === 'circuit').map(e => e.to)
              for (const tId of targets) {
                const pathQueue = [tId]
                const pathSeen = new Set<string>()
                while (pathQueue.length > 0) {
                  const pid = pathQueue.shift()!
                  if (pid === gNodeId || pathSeen.has(pid)) continue
                  pathSeen.add(pid)
                  visited.delete(pid)
                  for (const e of graphEdges) {
                    if (e.from === pid) pathQueue.push(e.to)
                  }
                }
              }
              visited.delete(gNodeId) // allow repeater to be re-reached via circuit-in
            } else {
              // Follow default edges
              targets = outEdges.filter(e => e.fromPort !== 'circuit').map(e => e.to)
            }
          } else {
            targets = adj.get(gNodeId) ?? []
          }

          for (const targetId of targets) {
            if (visited.has(targetId)) continue
            visited.add(targetId)
            nextFrontier.push(targetId)

            const gNode = graphNodes.find(n => n.id === targetId)
            if (!gNode) continue

            layerMaxDuration = Math.max(layerMaxDuration, dispatchEffect(ctx, gNode, totalDelay))
          }
        }

        totalDelay += layerMaxDuration
        frontier = nextFrontier
      }

      maxDuration = Math.max(maxDuration, totalDelay)
    }

    // If there's implicit media and no locked effect, still play media
    if (hasMedia && !hasLockedEffect && effects.length === 0) {
      const capturedNodeId = nodeId
      triggerMediaPlay(capturedNodeId)
      // Set up flowMediaDoneRef listener so the flow blocks until media finishes
      const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
      if (article) {
        const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
        if (media) {
          const onMediaDone = () => {
            flowMediaDoneRef.current.add(capturedNodeId)
            media.removeEventListener('pause', onMediaDone)
            media.removeEventListener('ended', onMediaDone)
          }
          const onPlaying = () => {
            media.removeEventListener('playing', onPlaying)
            media.addEventListener('pause', onMediaDone)
            media.addEventListener('ended', onMediaDone)
          }
          media.addEventListener('playing', onPlaying)
          maxDuration = Math.max(maxDuration, 600000)
        } else {
          // GIF/image: no media element, complete immediately
          flowMediaDoneRef.current.add(capturedNodeId)
          maxDuration = Math.max(maxDuration, 200)
        }
      } else {
        maxDuration = Math.max(maxDuration, 200)
      }
    }

    return maxDuration > 0 ? maxDuration : 100
  }, [])

  const executeNodeEffectsRef = useRef(executeNodeEffects)
  executeNodeEffectsRef.current = executeNodeEffects

  // ---- startFlowAnimation ----
  const startFlowAnimation = useCallback((startNodeId: string) => {
    stopFlowAnimationRef.current()
    // Build DAG from flow connections
    const flowConns = depsRef.current.model.connections.filter(c => c.type === 'flow')
    if (flowConns.length === 0) return

    // Build adjacency (outgoing) and incoming maps
    const outgoing = new Map<string, ModelConnection[]>()
    const incoming = new Map<string, ModelConnection[]>()
    for (const c of flowConns) {
      if (!outgoing.has(c.from)) outgoing.set(c.from, [])
      outgoing.get(c.from)!.push(c)
      if (!incoming.has(c.to)) incoming.set(c.to, [])
      incoming.get(c.to)!.push(c)
    }

    // BFS to discover all reachable nodes
    const reachableNodes = new Set<string>([startNodeId])
    const reachableConns: ModelConnection[] = []
    let frontier = [startNodeId]
    while (frontier.length > 0) {
      const nextFrontier: string[] = []
      for (const nodeId of frontier) {
        for (const c of outgoing.get(nodeId) ?? []) {
          reachableConns.push(c)
          if (!reachableNodes.has(c.to)) {
            reachableNodes.add(c.to)
            nextFrontier.push(c.to)
          }
        }
      }
      frontier = nextFrontier
    }

    // Build tasks
    const tasks = new Map<string, FlowTask>()

    // Compute node duration hint from effect graph
    const nodeDuration = (nodeId: string) => {
      const node = depsRef.current.model.nodes.find(n => n.id === nodeId)
      const hasEffects = node && ((node.flowEffects?.length ?? 0) > 0 || !!node.mediaType)
      return hasEffects ? 0 : 100 // 0 = will be computed at execution time
    }

    // Create node tasks
    for (const nodeId of reachableNodes) {
      const taskId = `node:${nodeId}`
      // Node depends on all incoming wire tasks from reachable connections
      const incomingWireDeps = (nodeId === startNodeId)
        ? []
        : reachableConns
            .filter(c => c.to === nodeId)
            .map(c => `wire:${c.from}->${c.to}`)
      tasks.set(taskId, {
        id: taskId,
        kind: 'node',
        nodeId,
        durationMs: nodeDuration(nodeId),
        dependsOn: incomingWireDeps,
        startTime: 0,
      })
    }

    // Create wire tasks
    for (const c of reachableConns) {
      const taskId = `wire:${c.from}->${c.to}`
      tasks.set(taskId, {
        id: taskId,
        kind: 'wire',
        connectionKey: `${c.from}->${c.to}`,
        durationMs: 600,
        dependsOn: [`node:${c.from}`],
        startTime: 0,
      })
    }

    if (tasks.size === 0) return

    const dag: FlowDAG = {
      tasks,
      activeTasks: new Set<string>(),
      completedTasks: new Set<string>(),
      untrackedPaths: new Set<string>(),
    }
    flowDAGRef.current = dag

    // Hide nodes that have an 'emerge' effect — they should be invisible until their emerge executes
    // Also collapse incoming connections to zero length via emergeAnimations
    const initialEmergeAnims = new Map<string, number>()
    for (const nodeId of reachableNodes) {
      const n = depsRef.current.model.nodes.find(nn => nn.id === nodeId)
      if (!n?.flowEffects) continue
      const hasEmerge = n.flowEffects.some(eff =>
        eff.graph.nodes.some(gn => gn.kind === 'emerge')
      )
      if (hasEmerge) {
        // Cosmetic nodes: hide the wrapper (contains SVG + article); regular: hide the article
        const wrapperEl = document.querySelector(`[data-node-wrapper="${CSS.escape(nodeId)}"]`) as HTMLElement | null
        const articleEl = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
        const el = wrapperEl ?? articleEl
        if (el) {
          el.style.opacity = '0'
          emergeHiddenElementsRef.current.push(el)
        }
        // Collapse all incoming flow connections to this node (skip hidden connections)
        for (const c of depsRef.current.model.connections) {
          if (c.to === nodeId && c.type === 'flow' && !c.hideDuringFlow) {
            initialEmergeAnims.set(`${c.from}->${c.to}`, 0)
          }
        }
      }
    }
    if (initialEmergeAnims.size > 0) setEmergeAnimations(initialEmergeAnims)

    // Check if any reachable node has cameraTracked — if so, enable flow camera
    const anyTracked = [...reachableNodes].some(nid => {
      const n = depsRef.current.model.nodes.find(nn => nn.id === nid)
      return n?.cameraTracked === true
    })
    if (anyTracked) {
      flowCameraRef.current = {
        preFlowPan: { x: depsRef.current.panOffsetRef.current.x, y: depsRef.current.panOffsetRef.current.y },
        preFlowScale: depsRef.current.freeScaleRef.current,
        lastTrackedCenter: null,
        active: true,
      }
    }

    // Helper: mark a task as untracked and propagate
    const markUntracked = (taskId: string) => {
      dag.untrackedPaths.add(taskId)
    }

    // Helper: check & set tracking status for a newly activated task
    const resolveTracking = (taskId: string, task: FlowTask) => {
      if (task.kind === 'wire') {
        // Wire inherits from its source node task
        if (dag.untrackedPaths.has(task.dependsOn[0])) markUntracked(taskId)
      } else {
        // Node: untracked if node.cameraTracked !== true, OR all incoming wires are untracked
        const nodeModel = depsRef.current.model.nodes.find(n => n.id === task.nodeId)
        if (nodeModel?.cameraTracked !== true) {
          markUntracked(taskId)
        } else if (task.dependsOn.length > 0 && task.dependsOn.every(dep => dag.untrackedPaths.has(dep))) {
          markUntracked(taskId)
        }
      }
    }

    // Activate tasks with no dependencies (just the start node)
    const now = performance.now()
    for (const [id, task] of tasks) {
      if (task.dependsOn.length === 0) {
        task.startTime = now
        dag.activeTasks.add(id)
        resolveTracking(id, task)
        if (task.kind === 'node') {
          setFlowActiveNodes(prev => new Set([...prev, task.nodeId]))
          const dur = executeNodeEffectsRef.current(task.nodeId)
          if (task.durationMs === 0) task.durationMs = Math.max(dur + 100, 200)
        }
      }
    }

    // Build a node-position lookup for camera focus computation
    const nodePositions = new Map<string, { x: number; y: number }>()
    for (const n of depsRef.current.model.nodes) {
      nodePositions.set(n.id, { x: n.x, y: n.y })
    }

    const rmmCameraScale = depsRef.current.rmmCameraScale

    const tick = (now: number) => {
      const d = flowDAGRef.current
      if (!d) return

      // Advance all active tasks
      const justCompleted: string[] = []
      const wireUpdates = new Map<string, number>()

      for (const taskId of d.activeTasks) {
        const task = d.tasks.get(taskId)!
        const elapsed = now - task.startTime
        const progress = Math.min(elapsed / task.durationMs, 1)

        if (task.kind === 'wire') {
          wireUpdates.set(task.connectionKey, progress)
        }

        if (progress >= 1 || (task.kind === 'node' && flowMediaDoneRef.current.has(task.nodeId))) {
          justCompleted.push(taskId)
        }
      }

      // Batch wire animation updates
      if (wireUpdates.size > 0) {
        setFlowAnimations(prev => {
          const next = new Map(prev)
          for (const [key, prog] of wireUpdates) next.set(key, prog)
          return next
        })
      }

      // Process completions and activate dependents
      if (justCompleted.length > 0) {
        for (const taskId of justCompleted) {
          d.activeTasks.delete(taskId)
          d.completedTasks.add(taskId)
        }

        // Check all pending tasks — activate any whose ALL deps are now met
        for (const [id, task] of d.tasks) {
          if (d.activeTasks.has(id) || d.completedTasks.has(id)) continue
          if (task.dependsOn.every(dep => d.completedTasks.has(dep))) {
            task.startTime = now
            d.activeTasks.add(id)
            resolveTracking(id, task)
            if (task.kind === 'node') {
              setFlowActiveNodes(prev => new Set([...prev, task.nodeId]))
              const dur = executeNodeEffectsRef.current(task.nodeId)
              if (task.durationMs === 0) task.durationMs = Math.max(dur + 100, 200)
            }
          }
        }
      }

      // ---- Camera tracking ----
      const cam = flowCameraRef.current
      const override = flowCameraOverrideRef.current
      if (cam?.active) {
        const vp = depsRef.current.vpSizeRef.current
        const scale = depsRef.current.effectiveScaleRef.current
        const curPanX = depsRef.current.panOffsetRef.current.x
        const curPanY = depsRef.current.panOffsetRef.current.y
        const lerpFactor = 0.08

        // Always run normal auto-tracking to compute base position
        const trackedPoints: { x: number; y: number }[] = []
        for (const taskId of d.activeTasks) {
          if (d.untrackedPaths.has(taskId)) continue
          const task = d.tasks.get(taskId)!
          if (task.kind === 'node') {
            const pos = nodePositions.get(task.nodeId)
            if (pos) trackedPoints.push(pos)
          } else {
            // Wire: interpolate between source and target
            const [fromId, toId] = task.connectionKey.split('->')
            const fromPos = nodePositions.get(fromId)
            const toPos = nodePositions.get(toId)
            if (fromPos && toPos) {
              const elapsed = now - task.startTime
              const progress = Math.min(elapsed / task.durationMs, 1)
              trackedPoints.push({
                x: fromPos.x + (toPos.x - fromPos.x) * progress,
                y: fromPos.y + (toPos.y - fromPos.y) * progress,
              })
            }
          }
        }

        // Compute base tracking pan target
        let basePanX = curPanX
        let basePanY = curPanY
        if (trackedPoints.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const p of trackedPoints) {
            if (p.x < minX) minX = p.x
            if (p.y < minY) minY = p.y
            if (p.x > maxX) maxX = p.x
            if (p.y > maxY) maxY = p.y
          }
          const focusX = (minX + maxX) / 2
          const focusY = (minY + maxY) / 2
          cam.lastTrackedCenter = { x: focusX, y: focusY }

          basePanX = vp.w / 2 - (focusX / 100) * SCENE_W * scale
          basePanY = vp.h / 2 - (focusY / 100) * SCENE_H * scale
        }

        if (override) {
          // Camera effect: each attribute has its own duration, easing, and reset mode.
          const elapsed = now - override.startTime
          const holdT = override.durationMs > 0 ? Math.min(elapsed / override.durationMs, 1) : 1

          // Easing functions
          const applyEasing = (t: number, easing: string) => {
            if (easing === 'ease-in') return t * t
            if (easing === 'ease-out') return 1 - (1 - t) * (1 - t)
            // ease-in-out
            return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
          }

          const attrProgress = (dur: number, resetMode: string, easing: string) => {
            if (dur <= 0) return resetMode === 'persist' ? 1 : 0
            if (resetMode === 'attr') {
              const at = Math.min(elapsed / dur, 1)
              if (at <= 0.5) {
                return applyEasing(at / 0.5, easing)
              } else {
                return 1 - applyEasing((at - 0.5) / 0.5, easing)
              }
            } else if (resetMode === 'node') {
              const at = Math.min(elapsed / dur, 1)
              const forward = applyEasing(at, easing)
              const remainingMs = override.durationMs - elapsed
              if (remainingMs < dur) {
                const revertT = Math.min(1 - remainingMs / dur, 1)
                return forward * (1 - applyEasing(revertT, easing))
              }
              return forward
            } else {
              // 'persist': animate to target, stay there
              const at = Math.min(elapsed / dur, 1)
              return applyEasing(at, easing)
            }
          }

          const panXProgress = attrProgress(override.panXDurationMs, override.panXResetMode, override.panXEasing)
          const panYProgress = attrProgress(override.panYDurationMs, override.panYResetMode, override.panYEasing)
          const zoomProgress = attrProgress(override.zoomDurationMs, override.zoomResetMode, override.zoomEasing)
          const rotProgress = attrProgress(override.rotationDurationMs, override.rotationResetMode, override.rotationEasing)

          // Compute base pan using the pre-override scale so zoom changes don't affect tracking
          const baseScale = rmmCameraScale * override.startFreeScale
          let trackPanX = curPanX, trackPanY = curPanY
          if (trackedPoints.length > 0) {
            const focus = cam.lastTrackedCenter!
            trackPanX = vp.w / 2 - (focus.x / 100) * SCENE_W * baseScale
            trackPanY = vp.h / 2 - (focus.y / 100) * SCENE_H * baseScale
          }

          // Pan: offset in scene-percentage units, converted to screen pixels
          const pxPerSceneX = SCENE_W * baseScale / 100
          const pxPerSceneY = SCENE_H * baseScale / 100
          const targetPanX = trackPanX + override.panX * pxPerSceneX * panXProgress
          const targetPanY = trackPanY + override.panY * pxPerSceneY * panYProgress
          const newPanX = curPanX + (targetPanX - curPanX) * lerpFactor
          const newPanY = curPanY + (targetPanY - curPanY) * lerpFactor
          depsRef.current.setPanOffset(newPanX, newPanY)

          // Zoom: lerp freeScale toward target based on zoomProgress
          if (override.zoom !== 1) {
            const targetFreeScale = override.startFreeScale + (override.startFreeScale * override.zoom - override.startFreeScale) * zoomProgress
            const curFS = depsRef.current.freeScaleRef.current
            depsRef.current.setFreeScale(curFS + (targetFreeScale - curFS) * lerpFactor)
          }

          // Rotation
          setFlowRotation(override.rotation * rotProgress)

          if (holdT >= 1) {
            // Hold duration expired — snapshot residuals for smooth fadeout
            const residualRot = override.rotationResetMode === 'persist'
              ? override.rotation * rotProgress
              : override.rotation * rotProgress // whatever is left
            const residualFSOffset = override.zoom !== 1
              ? depsRef.current.freeScaleRef.current - override.startFreeScale
              : 0
            flowCameraOverrideRef.current = null
            // Only create fadeout if there's something to fade
            if (Math.abs(residualRot) > 0.01 || Math.abs(residualFSOffset) > 0.001) {
              flowCameraFadeoutRef.current = {
                rotation: residualRot,
                freeScaleOffset: residualFSOffset,
                startFreeScale: override.startFreeScale,
              }
            } else {
              flowCameraFadeoutRef.current = null
              setFlowRotation(0)
              if (override.zoom !== 1) depsRef.current.setFreeScale(override.startFreeScale)
            }
          }
        } else {
          // No override — apply base tracking + smooth fadeout of residuals
          const fadeout = flowCameraFadeoutRef.current

          if (fadeout && Math.abs(fadeout.freeScaleOffset) > 0.001) {
            // During zoom fadeout, use the stable startFreeScale for pan computation
            // to avoid the SE jump caused by changing freeScale shifting the pan target
            const stableScale = rmmCameraScale * fadeout.startFreeScale
            let stablePanX = curPanX, stablePanY = curPanY
            if (trackedPoints.length > 0 && cam.lastTrackedCenter) {
              const focus = cam.lastTrackedCenter
              stablePanX = vp.w / 2 - (focus.x / 100) * SCENE_W * stableScale
              stablePanY = vp.h / 2 - (focus.y / 100) * SCENE_H * stableScale
            }
            depsRef.current.setPanOffset(
              curPanX + (stablePanX - curPanX) * lerpFactor,
              curPanY + (stablePanY - curPanY) * lerpFactor,
            )
          } else {
            const newPanX = curPanX + (basePanX - curPanX) * lerpFactor
            const newPanY = curPanY + (basePanY - curPanY) * lerpFactor
            depsRef.current.setPanOffset(newPanX, newPanY)
          }

          if (fadeout) {
            // Smoothly lerp residual rotation and zoom back to zero
            const fadeRate = 0.06 // per frame decay

            if (Math.abs(fadeout.rotation) > 0.01) {
              fadeout.rotation *= (1 - fadeRate)
              setFlowRotation(fadeout.rotation)
            } else {
              fadeout.rotation = 0
              setFlowRotation(0)
            }

            if (Math.abs(fadeout.freeScaleOffset) > 0.001) {
              fadeout.freeScaleOffset *= (1 - fadeRate)
              depsRef.current.setFreeScale(fadeout.startFreeScale + fadeout.freeScaleOffset)
            } else {
              fadeout.freeScaleOffset = 0
              depsRef.current.setFreeScale(fadeout.startFreeScale)
            }

            // Clear fadeout when everything has settled
            if (fadeout.rotation === 0 && fadeout.freeScaleOffset === 0) {
              flowCameraFadeoutRef.current = null
            }
          }
        }
      }

      // Check if all tasks are complete
      if (d.activeTasks.size === 0 && d.completedTasks.size === d.tasks.size) {
        // All done — keep final state briefly then clear
        flowTimeoutRef.current = setTimeout(() => {
          setFlowAnimations(new Map())
          setFlowActiveNodes(new Set())
          flowDAGRef.current = null
          flowMediaDoneRef.current.clear()
          // Stop flow recording and download result
          if (flowRecorderRef.current && flowRecorderRef.current.state !== 'inactive') {
            flowRecorderRef.current.stop()
            // onstop handler will assemble blob, download, and restore UI
          } else {
            // Stop stream tracks if recording never started
            if (flowRecordStreamRef.current) {
              flowRecordStreamRef.current.getTracks().forEach(t => t.stop())
              flowRecordStreamRef.current = null
            }
            setForceCollapseSidebars(false)
            setHideToolbar(false)
          }
          flowCameraOverrideRef.current = null
          flowCameraFadeoutRef.current = null
          restoreBrokenNodes()
          restoreEmergeNodes()
          // Restore colors changed by permanent color effects
          for (const { el, bg } of flowColorBackupsRef.current) {
            el.style.transition = 'background 400ms ease'
            el.style.background = bg
            setTimeout(() => { el.style.transition = '' }, 400)
          }
          flowColorBackupsRef.current = []
          // Clear text format timers and restore persistent formats
          for (const t of flowTextFormatTimersRef.current) clearTimeout(t)
          flowTextFormatTimersRef.current = []
          for (const { el, orig } of flowTextFormatBackupsRef.current) {
            el.style.fontWeight = orig.fontWeight
            el.style.fontStyle = orig.fontStyle
            el.style.textDecoration = orig.textDecoration
            el.style.color = orig.color
            el.style.fontSize = orig.fontSize
            el.style.transition = orig.transition
          }
          flowTextFormatBackupsRef.current = []
          for (const { el, orig } of flowTextFormatWrapperBackupsRef.current) {
            el.style.width = orig.width
            el.style.minWidth = orig.minWidth
            el.style.height = orig.height
            el.style.minHeight = orig.minHeight
            el.style.transition = orig.transition
          }
          flowTextFormatWrapperBackupsRef.current = []
          // Clear scale revert timers
          for (const t of scaleRevertTimersRef.current) clearTimeout(t)
          scaleRevertTimersRef.current = []
          // Stop keep-playing looping animations (jitter, float, move)
          for (const { rafId, cleanup } of flowKeepPlayingAnimsRef.current) {
            cancelAnimationFrame(rafId)
            cleanup()
          }
          flowKeepPlayingAnimsRef.current = []
          // Stop levitate animations started during flow
          for (const { rafId, cleanup } of flowLevitateAnimsRef.current) {
            cancelAnimationFrame(rafId)
            cleanup()
          }
          flowLevitateAnimsRef.current = []
          // Clear all scheduled effect timeouts
          for (const t of flowEffectTimersRef.current) clearTimeout(t)
          flowEffectTimersRef.current = []
          // Stop all playing media elements
          document.querySelectorAll('[data-node-id] video, [data-node-id] audio').forEach(el => {
            const media = el as HTMLVideoElement | HTMLAudioElement
            if (!media.paused) media.pause()
          })
          // Camera return animation
          const c = flowCameraRef.current
          if (c?.active) {
            const startPan = { x: depsRef.current.panOffsetRef.current.x, y: depsRef.current.panOffsetRef.current.y }
            const startScale = depsRef.current.freeScaleRef.current
            const startRot = flowRotationRef.current
            const targetPan = c.preFlowPan
            const targetScale = c.preFlowScale
            const animStart = performance.now()
            const duration = 500
            const animateBack = (t: number) => {
              const p = Math.min((t - animStart) / duration, 1)
              const ease = 1 - (1 - p) * (1 - p)
              depsRef.current.setPanOffset(
                startPan.x + (targetPan.x - startPan.x) * ease,
                startPan.y + (targetPan.y - startPan.y) * ease,
              )
              depsRef.current.setFreeScale(startScale + (targetScale - startScale) * ease)
              setFlowRotation(startRot * (1 - ease))
              if (p < 1) requestAnimationFrame(animateBack)
            }
            requestAnimationFrame(animateBack)
            flowCameraRef.current = null
          } else {
            setFlowRotation(0)
          }
        }, 400)
      } else {
        flowAnimRef.current = requestAnimationFrame(tick)
      }
    }

    flowAnimRef.current = requestAnimationFrame(tick)
  }, [])

  // Keep a stable ref so async RMM handoff callbacks can call the latest version
  const startFlowAnimationRef = useRef(startFlowAnimation)
  startFlowAnimationRef.current = startFlowAnimation

  // Cleanup on unmount
  useEffect(() => () => {
    if (flowAnimRef.current != null) cancelAnimationFrame(flowAnimRef.current)
    if (flowTimeoutRef.current != null) clearTimeout(flowTimeoutRef.current)
  }, [])

  // Check if selected node is part of a flow
  const selectedNodeIsInFlow = useMemo(() => {
    const { model, selectedNodeId } = depsRef.current
    if (!selectedNodeId) return false
    return model.connections.some(c => c.type === 'flow' && (c.from === selectedNodeId || c.to === selectedNodeId))
  }, [deps.selectedNodeId, deps.model.connections])

  const isFlowPlaying = flowDAGRef.current != null

  return {
    flowAnimations,
    emergeAnimations,
    flowActiveNodes,
    startFlowAnimation,
    stopFlowAnimation,
    forceCollapseSidebars,
    hideToolbar,
    editingEffect,
    setEditingEffect,
    shakeOffset,
    flowRotation,
    selectedNodeIsInFlow,
    alwaysPlayAnimsRef,
    isFlowPlaying,
  }
}
