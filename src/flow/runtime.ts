/**
 * FlowRuntime — schedules effect graphs against diagram nodes and produces
 * per-frame `NodeOverride`s. The runtime owns *no* DOM and mutates *no* store
 * state — its only outputs are the override map (read by the renderer) and
 * an "any-active" flag (read by the renderer to know whether to mark dirty).
 *
 * Lifecycle:
 *   const runId = runtime.start(targetNodeId, effect, now)
 *   runtime.tick(now)            // each frame; updates overrides
 *   runtime.cancel(runId)        // O(1); drops every task in the run
 *   runtime.isActive(runId)      // false once all tasks finished
 *
 * Scheduling: tasks are released in topological order. A task with no inbound
 * edges starts at run-start; otherwise it starts when *all* upstream tasks
 * have finished. Cycles are rejected at `start()` time (the run is dropped
 * with an empty task set).
 */

import type {
  CameraOverride,
  EffectEdge,
  EffectNode,
  FlowEffect,
  NodeOverride,
  SpawnItem,
} from './types'
import { mergeCameraOverride, mergeOverride } from './types'

interface Task {
  id: string
  node: EffectNode
  /** ms after run start when this task should begin. */
  startAt: number
  /** Total duration in ms (0 for instant or pure-source tasks). */
  durationMs: number
  /** Duration downstream tasks should wait after this task starts. */
  blockMs: number
  /** ids of tasks this one waits on (nodes with edges into us). */
  dependsOn: string[]
  /** Set once `startAt` is computed (after dependsOn complete). */
  scheduled: boolean
  /** ms when the task completed (− means not yet). */
  endedAt: number
  /**
   * For side-effect kinds (e.g. `text-generator`), set true once the runtime
   * fired the start callback so it isn't re-triggered each frame.
   */
  sideEffectFired?: boolean
}

interface Run {
  id: string
  targetNodeId: string
  startedAt: number
  tasks: Map<string, Task>
  /** Tasks currently producing overrides. */
  active: Set<string>
  /** Reverse adjacency: id → ids of tasks that depend on this one. */
  dependents: Map<string, string[]>
  /** When true, the run rewinds to start once all tasks complete. */
  loop: boolean
  /** Cumulative override held past task end for `permanent`-flagged tasks. */
  held: NodeOverride | null
  /** Held camera contribution (e.g. permanent `camera` task). */
  cameraHeld: CameraOverride | null
  /**
   * Per-task remaining repeats from `repeater` nodes. When > 0, completing
   * the run rewinds and decrements; 0 means done; -1 means infinite.
   */
  repeatLeft: number
}

let RUN_COUNTER = 0
const PHASE_CACHE_LIMIT = 4096
const phaseCache = new Map<string, number>()

export class FlowRuntime {
  private runs = new Map<string, Run>()
  /** Aggregated per-target-node override for *this* tick. */
  private overrides = new Map<string, NodeOverride>()
  /** Aggregated camera override for *this* tick (null when none). */
  private cameraOverride: CameraOverride | null = null

  /**
   * Side-effect bridge for kinds that touch external state the renderer
   * owns (currently only `text-generator`, which delegates to the
   * `TextGenRunner`). Optional — when unset, side-effect tasks no-op.
   * `start` fires once per task when scheduled; `stop` fires on cancel,
   * task end, or run drain.
   */
  onTextGen: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  onTextGenStop: ((targetNodeId: string) => void) | null = null
  onTextFormat: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  onTextFormatStop: ((targetNodeId: string) => void) | null = null
  /**
   * Recording side-effects — mirror the text-generator pattern. The renderer
   * owns the actual `MediaRecorder` / OBS-WebSocket session; the runtime only
   * fires start/stop on the task lifecycle.
   */
  onRecord: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  onRecordStop: ((targetNodeId: string) => void) | null = null
  onObsRecord: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  onObsRecordStop: ((targetNodeId: string) => void) | null = null
  /**
   * Handoff side-effects. These mutate global navigation state (the RMM
   * zoom stack and the MPD active dimension) so they live entirely in the
   * renderer/store layer; the runtime just signals start. There is no
   * meaningful `stop` semantic for navigation — handoffs are one-shot
   * transitions — so only a fire-once start callback is exposed.
   */
  onHandoffRmm: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  onReturnRmm: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  onHandoffMpd: ((targetNodeId: string, params: Record<string, number>) => void) | null = null
  /**
   * Spawn side-effects — emit ephemeral decorative children around the
   * host node. The renderer owns the actual sprites; the runtime only
   * fires start/stop on the task lifecycle so the renderer can fade them
   * in (start) and fade them out + dispose (stop).
   */
  onSpawn: ((targetNodeId: string, params: Record<string, number>, effectNodeId: string, spawnItems?: SpawnItem[]) => void) | null = null
  onSpawnStop: ((targetNodeId: string, effectNodeId: string) => void) | null = null
  onSpawnCircular: ((targetNodeId: string, params: Record<string, number>, effectNodeId: string, spawnItems?: SpawnItem[]) => void) | null = null
  onSpawnCircularStop: ((targetNodeId: string, effectNodeId: string) => void) | null = null

  /** Returns the run id, or null if the graph was empty / cyclic. */
  start(targetNodeId: string, effect: FlowEffect, now: number): string | null {
    const { nodes, edges } = effect.graph
    if (nodes.length === 0) return null
    const repeaterTasks = nodes.some((n) => n.kind === 'repeater' && edges.some((e) => e.from === n.id && e.fromPort === 'circuit'))
      ? buildRepeaterTasks(nodes, edges)
      : null
    if (repeaterTasks) {
      if (repeaterTasks.size === 0) return null
      const runId = `run_${++RUN_COUNTER}`
      this.runs.set(runId, {
        id: runId,
        targetNodeId,
        startedAt: now,
        tasks: repeaterTasks,
        active: new Set(),
        dependents: new Map(),
        loop: effect.alwaysPlay === true,
        held: null,
        cameraHeld: null,
        repeatLeft: 0,
      })
      return runId
    }
    const tasks = new Map<string, Task>()
    const incoming = new Map<string, string[]>()
    const dependents = new Map<string, string[]>()
    for (const n of nodes) {
      incoming.set(n.id, [])
      dependents.set(n.id, [])
    }
    for (const e of edges) {
      incoming.get(e.to)?.push(e.from)
      dependents.get(e.from)?.push(e.to)
    }
    // Cycle detection via Kahn's algorithm pass.
    const indeg = new Map<string, number>()
    for (const [id, inc] of incoming) indeg.set(id, inc.length)
    const queue: string[] = []
    for (const [id, d] of indeg) if (d === 0) queue.push(id)
    let visited = 0
    while (queue.length > 0) {
      const id = queue.shift()!
      visited++
      for (const dep of dependents.get(id) ?? []) {
        const left = (indeg.get(dep) ?? 0) - 1
        indeg.set(dep, left)
        if (left === 0) queue.push(dep)
      }
    }
    if (visited !== nodes.length) return null // cycle
    for (const n of nodes) {
      tasks.set(n.id, {
        id: n.id,
        node: n,
        startAt: 0,
        durationMs: durationOf(n),
        blockMs: blockDurationOf(n),
        dependsOn: incoming.get(n.id) ?? [],
        scheduled: false,
        endedAt: -1,
      })
    }
    const runId = `run_${++RUN_COUNTER}`
    // Sum repeats across all `repeater` nodes; -1 (infinite) wins.
    let repeatLeft = 0
    for (const n of nodes) {
      if (n.kind === 'repeater') {
        const t = (n.params.repeatCount ?? n.params.times ?? 0) | 0
        if (t < 0) { repeatLeft = -1; break }
        repeatLeft += t
      }
    }
    this.runs.set(runId, {
      id: runId,
      targetNodeId,
      startedAt: now,
      tasks,
      active: new Set(),
      dependents,
      loop: effect.alwaysPlay === true,
      held: null,
      cameraHeld: null,
      repeatLeft,
    })
    return runId
  }

  /** Stop a run immediately. Overrides for its target are cleared next tick. */
  cancel(runId: string): void {
    const run = this.runs.get(runId)
    if (run) this.fireSideEffectStops(run)
    this.runs.delete(runId)
  }

  isActive(runId: string): boolean {
    return this.runs.has(runId)
  }

  /** True if any run has unfinished tasks. */
  get hasActiveRuns(): boolean {
    return this.runs.size > 0
  }

  /**
   * Recompute the override map for the current frame. Call once per frame
   * BEFORE the renderer reads `getOverride()`.
   */
  tick(now: number): void {
    this.overrides.clear()
    this.cameraOverride = null
    for (const [id, run] of [...this.runs]) {
      // A looped run may complete and rewind multiple times within a single
      // tick (e.g. unfocused tab catching up). Cap the rewinds to keep this
      // bounded; non-looped runs simply break after one pass.
      for (let i = 0; i < 8; i++) {
        this.tickRun(run, now)
        let anyAlive = false
        for (const t of run.tasks.values()) {
          if (t.endedAt < 0) {
            anyAlive = true
            break
          }
        }
        if (anyAlive) break
        if (!run.loop && run.repeatLeft === 0) {
          this.fireSideEffectStops(run)
          this.runs.delete(id)
          break
        }
        if (run.repeatLeft > 0) run.repeatLeft -= 1
        // Rewind: bump start time by total cycle length and clear task state.
        let cycle = 0
        for (const t of run.tasks.values()) {
          const end = t.startAt + t.durationMs
          if (end > cycle) cycle = end
        }
        if (cycle <= 0) cycle = 16 // safety: avoid tight loop on zero-length
        run.startedAt += cycle
        for (const t of run.tasks.values()) {
          t.scheduled = false
          t.startAt = 0
          t.endedAt = -1
          t.sideEffectFired = false
        }
        // If we're still past the new cycle end, loop again to catch up.
        if (now - run.startedAt < cycle) {
          // Re-run contribution for the rewound cycle.
          this.tickRun(run, now)
          break
        }
      }
    }
  }

  /** Get aggregated override for a target node, or undefined if none. */
  getOverride(targetNodeId: string): NodeOverride | undefined {
    return this.overrides.get(targetNodeId)
  }

  /** Aggregated camera override across all active runs (or undefined). */
  getCameraOverride(): CameraOverride | undefined {
    return this.cameraOverride ?? undefined
  }

  // ---- internals --------------------------------------------------------

  private tickRun(run: Run, now: number): void {
    const elapsed = now - run.startedAt
    // 1. Schedule pass — propagate `startAt` through the topology. A task is
    //    scheduled once *all* its dependencies have a known `startAt`. Repeat
    //    until no further progress (linear in graph size for a DAG).
    let progressed = true
    while (progressed) {
      progressed = false
      for (const t of run.tasks.values()) {
        if (t.scheduled) continue
        let allReady = true
        let latestEnd = 0
        for (const depId of t.dependsOn) {
          const dep = run.tasks.get(depId)
          if (!dep || !dep.scheduled) {
            allReady = false
            break
          }
          const depEnd = dep.startAt + dep.blockMs
          if (depEnd > latestEnd) latestEnd = depEnd
        }
        if (allReady) {
          t.startAt = latestEnd + delayOf(t.node)
          t.scheduled = true
          progressed = true
        }
      }
    }
    // 2. Contribution pass — single sweep, each task contributes at most once.
    //    After a task's lifetime, its visual contribution stops UNLESS it has
    //    a `permanent` flag, in which case its end-of-task value is captured
    //    into `run.held` and merged each subsequent tick (cancellation still
    //    drops everything since the run leaves the runtime).
    let merged: NodeOverride | null = run.held
    let cameraMerged: CameraOverride | null = run.cameraHeld
    for (const t of run.tasks.values()) {
      if (!t.scheduled) continue
      const taskEnd = t.startAt + t.durationMs
      if (elapsed >= taskEnd) {
        if (t.endedAt < 0) {
          t.endedAt = taskEnd
          // Side-effect tasks: fire stop on completion.
          if (t.node.kind === 'text-generator' && t.sideEffectFired) {
            this.onTextGenStop?.(run.targetNodeId)
            t.sideEffectFired = false
          } else if (t.node.kind === 'text-format' && t.sideEffectFired) {
            if (!shouldKeepPlaying(t.node)) {
              this.onTextFormatStop?.(run.targetNodeId)
              t.sideEffectFired = false
            }
          } else if (t.node.kind === 'record' && t.sideEffectFired) {
            this.onRecordStop?.(run.targetNodeId)
            t.sideEffectFired = false
          } else if (t.node.kind === 'obs-record' && t.sideEffectFired) {
            this.onObsRecordStop?.(run.targetNodeId)
            t.sideEffectFired = false
          } else if (t.node.kind === 'spawn' && t.sideEffectFired) {
            this.onSpawnStop?.(run.targetNodeId, t.node.id)
            t.sideEffectFired = false
          } else if (t.node.kind === 'spawn-circular' && t.sideEffectFired) {
            this.onSpawnCircularStop?.(run.targetNodeId, t.node.id)
            t.sideEffectFired = false
          }
          // Capture final value for permanent-flagged kinds.
          if ((t.node.params.permanent ?? 0) !== 0) {
            if (t.node.kind === 'camera') {
              const finalCam = cameraContribution(t.node, 1)
              if (finalCam) {
                run.cameraHeld = run.cameraHeld
                  ? mergeCameraOverride(run.cameraHeld, finalCam)
                  : finalCam
                cameraMerged = cameraMerged
                  ? mergeCameraOverride(cameraMerged, finalCam)
                  : finalCam
              }
            } else {
              const finalContrib = contribution(t.node, 1, t.durationMs, run.targetNodeId)
              if (finalContrib) {
                run.held = run.held
                  ? mergeOverride(run.held, finalContrib)
                  : finalContrib
                merged = merged ? mergeOverride(merged, finalContrib) : finalContrib
              }
            }
          }
        }
        if (shouldKeepPlaying(t.node) && runHasUnfinishedTasks(run) && t.durationMs > 0) {
          const loopElapsed = (elapsed - t.startAt) % t.durationMs
          const loopRatio = loopElapsed / t.durationMs
          if (t.node.kind === 'camera') {
            const cam = cameraContribution(t.node, loopRatio)
            if (cam) cameraMerged = cameraMerged ? mergeCameraOverride(cameraMerged, cam) : cam
          } else {
            const contrib = contribution(t.node, loopRatio, loopElapsed, run.targetNodeId)
            if (contrib) merged = merged ? mergeOverride(merged, contrib) : contrib
          }
        }
        continue
      }
      if (elapsed < t.startAt) continue
      const localElapsed = elapsed - t.startAt
      const ratio = t.durationMs > 0 ? localElapsed / t.durationMs : 1
      if (t.node.kind === 'camera') {
        const cam = cameraContribution(t.node, ratio)
        if (cam) cameraMerged = cameraMerged ? mergeCameraOverride(cameraMerged, cam) : cam
      } else if (t.node.kind === 'text-generator') {
        // Side-effect: fire start exactly once when the task becomes active.
        if (!t.sideEffectFired) {
          t.sideEffectFired = true
          this.onTextGen?.(run.targetNodeId, t.node.params)
        }
      } else if (t.node.kind === 'text-format') {
        if (!t.sideEffectFired) {
          t.sideEffectFired = true
          this.onTextFormat?.(run.targetNodeId, t.node.params)
        }
      } else if (t.node.kind === 'record') {
        if (!t.sideEffectFired) {
          t.sideEffectFired = true
          this.onRecord?.(run.targetNodeId, t.node.params)
        }
      } else if (t.node.kind === 'obs-record') {
        if (!t.sideEffectFired) {
          t.sideEffectFired = true
          this.onObsRecord?.(run.targetNodeId, t.node.params)
        }
      } else if (
        t.node.kind === 'handoff-rmm' ||
        t.node.kind === 'return-rmm' ||
        t.node.kind === 'handoff-mpd'
      ) {
        if (!t.sideEffectFired) {
          t.sideEffectFired = true
          if (t.node.kind === 'handoff-rmm') this.onHandoffRmm?.(run.targetNodeId, t.node.params)
          else if (t.node.kind === 'return-rmm') this.onReturnRmm?.(run.targetNodeId, t.node.params)
          else this.onHandoffMpd?.(run.targetNodeId, t.node.params)
        }
      } else if (t.node.kind === 'spawn' || t.node.kind === 'spawn-circular') {
        if (!t.sideEffectFired) {
          t.sideEffectFired = true
          if (t.node.kind === 'spawn') this.onSpawn?.(run.targetNodeId, t.node.params, t.node.id, t.node.spawnItems)
          else this.onSpawnCircular?.(run.targetNodeId, t.node.params, t.node.id, t.node.spawnItems)
        }
      } else {
        const contrib = contribution(t.node, ratio, localElapsed, run.targetNodeId)
        if (contrib) merged = merged ? mergeOverride(merged, contrib) : contrib
        if (t.node.kind === 'break') {
          const shake = breakScreenShake(t.node, localElapsed)
          if (shake) cameraMerged = cameraMerged ? mergeCameraOverride(cameraMerged, shake) : shake
        }
      }
    }
    if (!run.loop && run.repeatLeft === 0 && !runHasUnfinishedTasks(run)) return
    if (merged) {
      const cur = this.overrides.get(run.targetNodeId)
      this.overrides.set(
        run.targetNodeId,
        cur ? mergeOverride(cur, merged) : merged,
      )
    }
    if (cameraMerged) {
      this.cameraOverride = this.cameraOverride
        ? mergeCameraOverride(this.cameraOverride, cameraMerged)
        : cameraMerged
    }
  }

  /**
   * Fire `onTextGenStop` for every text-generator task in the run that
   * had previously fired its start side-effect. Idempotent — safe to call
   * on cancel even when no side effects ran.
   */
  private fireSideEffectStops(run: Run): void {
    for (const t of run.tasks.values()) {
      if (!t.sideEffectFired) continue
      if (t.node.kind === 'text-generator') this.onTextGenStop?.(run.targetNodeId)
      else if (t.node.kind === 'text-format') this.onTextFormatStop?.(run.targetNodeId)
      else if (t.node.kind === 'record') this.onRecordStop?.(run.targetNodeId)
      else if (t.node.kind === 'obs-record') this.onObsRecordStop?.(run.targetNodeId)
      else if (t.node.kind === 'spawn') this.onSpawnStop?.(run.targetNodeId, t.node.id)
      else if (t.node.kind === 'spawn-circular') this.onSpawnCircularStop?.(run.targetNodeId, t.node.id)
      t.sideEffectFired = false
    }
  }

}

function runHasUnfinishedTasks(run: Run): boolean {
  for (const t of run.tasks.values()) if (t.endedAt < 0) return true
  return false
}

function buildRepeaterTasks(nodes: EffectNode[], edges: EffectEdge[]): Map<string, Task> | null {
  const byId = new Map<string, EffectNode>()
  const outgoing = new Map<string, EffectEdge[]>()
  const incomingCount = new Map<string, number>()
  for (const n of nodes) {
    byId.set(n.id, n)
    outgoing.set(n.id, [])
    incomingCount.set(n.id, 0)
  }
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    outgoing.get(e.from)?.push(e)
    incomingCount.set(e.to, (incomingCount.get(e.to) ?? 0) + 1)
  }

  let frontier = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0).map((n) => n.id)
  if (frontier.length === 0) {
    const entry = nodes.find((n) => n.id === '__entry__')
    const repeater = nodes.find((n) => n.kind === 'repeater')
    frontier = [entry?.id ?? repeater?.id ?? nodes[0]?.id].filter(Boolean) as string[]
  }
  if (frontier.length === 0) return new Map()

  const visited = new Set(frontier)
  const repeaterCounters = new Map<string, number>()
  const tasks = new Map<string, Task>()
  let delay = 0
  let seq = 0
  let safety = 0

  const clearCircuitPath = (startIds: string[], repeaterId: string) => {
    const q = [...startIds]
    const seen = new Set<string>()
    while (q.length > 0) {
      const id = q.shift()!
      if (id === repeaterId || seen.has(id)) continue
      seen.add(id)
      visited.delete(id)
      for (const e of outgoing.get(id) ?? []) q.push(e.to)
    }
    visited.delete(repeaterId)
  }

  while (frontier.length > 0 && safety++ < 10000) {
    const next: string[] = []
    let layerMax = 0
    for (const id of frontier) {
      const node = byId.get(id)
      if (!node) continue
      const startAt = delay + delayOf(node)
      const taskId = `${id}#${seq++}`
      tasks.set(taskId, {
        id: taskId,
        node,
        startAt,
        durationMs: durationOf(node),
        blockMs: blockDurationOf(node),
        dependsOn: [],
        scheduled: true,
        endedAt: -1,
      })
      layerMax = Math.max(layerMax, delayOf(node) + blockDurationOf(node))

      const outs = outgoing.get(id) ?? []
      let targets: string[]
      if (node.kind === 'repeater') {
        const count = (repeaterCounters.get(id) ?? 0) + 1
        repeaterCounters.set(id, count)
        const repeatCount = Math.max(0, Math.floor(node.params.repeatCount ?? node.params.times ?? 3))
        if (count <= repeatCount) {
          targets = outs.filter((e) => e.fromPort === 'circuit').map((e) => e.to)
          clearCircuitPath(targets, id)
        } else {
          targets = outs.filter((e) => (e.fromPort ?? 'default') !== 'circuit').map((e) => e.to)
        }
      } else {
        targets = outs.map((e) => e.to)
      }
      for (const target of targets) {
        if (visited.has(target)) continue
        visited.add(target)
        next.push(target)
      }
    }
    delay += layerMax
    frontier = next
  }
  return tasks
}

function shouldKeepPlaying(n: EffectNode): boolean {
  return (n.params.keepPlaying ?? 0) !== 0 || (n.kind === 'text-format' && (n.params.formatMode ?? 0) === 1)
}

function durationOf(n: EffectNode): number {
  if (n.kind === 'wait') return Math.max(0, n.params.ms ?? 0)
  if (n.kind === 'text-generator' || n.kind === 'text-format') {
    // Side-effect tasks need a duration so the runtime can fire `onTextGenStop`
    // on completion. Default 1.5 s is enough for short labels at 24 cps;
    // editor exposes `ms` for longer text.
    return Math.max(0, n.params.ms ?? 1500)
  }
  if (n.kind === 'record' || n.kind === 'obs-record') {
    // Recording side-effects also rely on `ms` to schedule the stop callback.
    return Math.max(0, n.params.ms ?? 5000)
  }
  if (n.kind === 'handoff-rmm' || n.kind === 'return-rmm' || n.kind === 'handoff-mpd') {
    // Navigation side-effects — `ms` gates how long the task occupies the
    // run before downstream effects fire. Default tracks the curtain/zoom
    // animation budget (~600 ms).
    return Math.max(0, n.params.ms ?? 600)
  }
  if (n.kind === 'spawn' || n.kind === 'spawn-circular') {
    // Spawn side-effects: `ms` is the on-screen lifetime of the ephemeral
    // children. After completion the runtime fires the stop callback and
    // the renderer fades them out.
    return Math.max(0, n.params.ms ?? 1500)
  }
  return Math.max(0, n.params.ms ?? 0)
}

function delayOf(n: EffectNode): number {
  return Math.max(0, n.params.delayMs ?? 0)
}

function blockDurationOf(n: EffectNode): number {
  if (n.kind === 'text-format' && (n.params.formatMode ?? 0) === 1) return 0
  const waits = (n.params.waitForFinish ?? 1) !== 0
  return waits ? durationOf(n) : 0
}

export function estimateFlowEffectDuration(effect: FlowEffect): number {
  const { nodes, edges } = effect.graph
  if (nodes.length === 0) return 0
  if (nodes.some((n) => n.kind === 'repeater' && edges.some((e) => e.from === n.id && e.fromPort === 'circuit'))) {
    const tasks = buildRepeaterTasks(nodes, edges)
    if (!tasks) return 0
    let maxEnd = 0
    for (const t of tasks.values()) maxEnd = Math.max(maxEnd, t.startAt + durationOf(t.node))
    return maxEnd
  }
  const incoming = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()
  for (const n of nodes) {
    incoming.set(n.id, [])
    dependents.set(n.id, [])
  }
  for (const e of edges) {
    incoming.get(e.to)?.push(e.from)
    dependents.get(e.from)?.push(e.to)
  }
  const indeg = new Map<string, number>()
  for (const [id, inc] of incoming) indeg.set(id, inc.length)
  const queue: string[] = []
  for (const [id, d] of indeg) if (d === 0) queue.push(id)
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift()!
    visited++
    for (const dep of dependents.get(id) ?? []) {
      const left = (indeg.get(dep) ?? 0) - 1
      indeg.set(dep, left)
      if (left === 0) queue.push(dep)
    }
  }
  if (visited !== nodes.length) return 0

  const scheduled = new Set<string>()
  const startAt = new Map<string, number>()
  let progressed = true
  while (progressed) {
    progressed = false
    for (const n of nodes) {
      if (scheduled.has(n.id)) continue
      let allReady = true
      let latestEnd = 0
      for (const depId of incoming.get(n.id) ?? []) {
        if (!scheduled.has(depId)) {
          allReady = false
          break
        }
        const dep = nodes.find((candidate) => candidate.id === depId)
        if (dep) latestEnd = Math.max(latestEnd, (startAt.get(depId) ?? 0) + blockDurationOf(dep))
      }
      if (allReady) {
        startAt.set(n.id, latestEnd + delayOf(n))
        scheduled.add(n.id)
        progressed = true
      }
    }
  }
  if (scheduled.size !== nodes.length) return 0
  let maxEnd = 0
  for (const n of nodes) maxEnd = Math.max(maxEnd, (startAt.get(n.id) ?? 0) + durationOf(n))
  return maxEnd
}

/**
 * Per-effect-kind contribution at the given ratio (0–1) of the task lifetime.
 * Returns null when the kind has no visual contribution (e.g. `wait`).
 */
function contribution(
  n: EffectNode,
  ratio: number,
  localElapsed: number,
  targetNodeId = '',
): NodeOverride | null {
  switch (n.kind) {
    case 'wait':
      return null
    case 'move': {
      // `roundtrip` (truthy): ramp 0→1→0 across the lifetime so the node
      // returns to its origin at end-of-task.
      const roundtrip = (n.params.roundtrip ?? 0) !== 0
      const t = roundtrip ? Math.sin(Math.PI * ratio) : ratio
      const dx = (n.params.dx ?? 0) * t
      const dy = (n.params.dy ?? 0) * t
      return { dx, dy }
    }
    case 'scale': {
      const target = n.params.mul ?? 1
      const scaleMul = 1 + (target - 1) * ratio
      return { scaleMul }
    }
    case 'expand': {
      // Grow from current size toward `mul` (default 1.5×). Scale-only;
      // alpha stays at 1 so the node doesn't fade. `permanent` holds final.
      const target = n.params.mul ?? 1.5
      const scaleMul = 1 + (target - 1) * ratio
      return { scaleMul }
    }
    case 'collapse': {
      // Shrink toward `1/mul` (default 1/1.5 ≈ 0.67×). Symmetrical inverse
      // of expand so a paired expand→collapse returns to identity.
      const target = 1 / Math.max(0.001, n.params.mul ?? 1.5)
      const scaleMul = 1 + (target - 1) * ratio
      return { scaleMul }
    }
    case 'color': {
      const tint = (n.params.tint ?? 0xffffff) | 0
      // Lerp from white toward tint.
      const r = lerp(255, (tint >> 16) & 0xff, ratio)
      const g = lerp(255, (tint >> 8) & 0xff, ratio)
      const b = lerp(255, tint & 0xff, ratio)
      return { tint: (r << 16) | (g << 8) | b }
    }
    case 'jitter': {
      const intensityPx = n.params.intensity ?? ((n.params.amp ?? 0.25) / 100) * 1920
      const decay = shouldKeepPlaying(n) ? 1 : Math.max(0, 1 - ratio)
      // Legacy Unigram used per-frame random offsets with a decay envelope.
      // Keep it deterministic for tests, but sample at rAF cadence so the
      // result reads as a nervous tremor instead of a smooth orbit.
      const step = Math.floor(localElapsed / (1000 / 60))
      const seed = targetNodeId || n.id
      const dxPx = (hashNoise(seed, step * 2 + 17) * 2 - 1) * intensityPx * decay
      const dyPx = (hashNoise(seed, step * 2 + 101) * 2 - 1) * intensityPx * decay
      const dx = (dxPx / 1920) * 100
      const dy = (dyPx / 1080) * 100
      return { dx, dy }
    }
    case 'float': {
      // Sinusoidal hover. `amp` in scene-percent, `freq` in Hz (default 1).
      const amp = n.params.amp ?? 0.5
      const freq = n.params.freq ?? 1
      const t = localElapsed / 1000
      return { dy: Math.sin(t * 2 * Math.PI * freq) * amp }
    }
    case 'emerge': {
      // Alpha + scale 0→1 (or fromScale→1).
      const fromScale = n.params.fromScale ?? 0
      return {
        alphaMul: ratio,
        scaleMul: fromScale + (1 - fromScale) * ratio,
      }
    }
    case 'dismiss': {
      // Alpha + scale 1→0 (or 1→toScale).
      const toScale = n.params.toScale ?? 0
      return {
        alphaMul: 1 - ratio,
        scaleMul: 1 + (toScale - 1) * ratio,
      }
    }
    case 'cloud-levitate': {
      // Match the prototype's independent X/Y/rotation rates. The built-in
      // duration is a full common cycle, so always-play loops reconnect.
      const ampX = n.params.ampX ?? 0.1667
      const ampY = n.params.ampY ?? 0.7407
      const rotAmp = n.params.rotAmp ?? 1.5
      const speed = n.params.speed ?? 0.8
      const durationSec = Math.max(0.001, (n.params.ms ?? 25000) / 1000)
      const baseCycles = quantizedCycles(speed * durationSec, 10)
      const s = ratio * Math.PI * 2 * baseCycles
      const phaseX = phaseFor(targetNodeId || n.id, 0)
      const phaseY = phaseFor(targetNodeId || n.id, 1)
      return {
        dx: Math.sin(s * 0.7 + phaseX) * ampX,
        dy: Math.sin(s * 0.5 + phaseY) * ampY,
        rotationDeg: Math.sin(s * 0.3 + phaseX) * rotAmp,
      }
    }
    case 'bubble-levitate': {
      // Match the prototype's soap-bubble Lissajous drift and scale pulse.
      const ampX = n.params.ampX ?? 0.3125
      const ampY = n.params.ampY ?? 0.9259
      const scaleAmp = n.params.scaleAmp ?? 0.03
      const scalePulse = (n.params.scalePulse ?? 1) !== 0
      const speed = n.params.speed ?? 0.5
      const durationSec = Math.max(0.001, (n.params.ms ?? 10000) / 1000)
      const baseCycles = quantizedCycles(speed * durationSec, 5)
      const s = ratio * Math.PI * 2 * baseCycles
      const phaseX = phaseFor(targetNodeId || n.id, 0)
      const phaseY = phaseFor(targetNodeId || n.id, 1)
      return {
        dx: Math.sin(s * 0.6 + phaseX) * ampX,
        dy: Math.sin(s * 0.4 + phaseY) * ampY,
        scaleMul: scalePulse ? 1 + scaleAmp * Math.sin(s * 0.8) : 1,
      }
    }
    case 'break': {
      const axis = n.params.axis === 1 ? 'vertical' : 'horizontal'
      const shakeIntensity = n.params.shakeIntensity ?? 8
      const shakeDurationMs = Math.max(1, n.params.shakeDurationMs ?? 300)
      const fallDurationMs = Math.max(1, n.params.fallDurationMs ?? 600)
      const shakeRatio = Math.min(1, localElapsed / shakeDurationMs)
      const fallRatio = Math.max(0, Math.min(1, (localElapsed - shakeDurationMs) / fallDurationMs))
      const decay = localElapsed < shakeDurationMs ? 1 - shakeRatio : 0
      return {
        alphaMul: 0,
        breakApart: {
          axis,
          shakeX: Math.sin(localElapsed * 0.11) * shakeIntensity * decay,
          shakeY: Math.cos(localElapsed * 0.13) * shakeIntensity * decay,
          fallRatio: easeInCubic(fallRatio),
        },
      }
    }
    case 'repeater':
      // Pure scheduling node — no per-frame contribution. Repeat semantics
      // are applied by `tick()` when the run drains.
      return null
    case 'camera':
      // Camera contributions live in a separate channel; this switch only
      // handles per-node overrides. The runtime branches before calling.
      return null
    case 'text-generator':
    case 'text-format':
      // Side-effect kind: bridged via `onTextGen` / `onTextGenStop`. No
      // per-frame override contribution.
      return null
    case 'record':
    case 'obs-record':
      // Side-effect kinds: bridged via `onRecord` / `onObsRecord`. No
      // per-frame override contribution.
      return null
    case 'handoff-rmm':
    case 'return-rmm':
    case 'handoff-mpd':
      // Navigation side-effects: bridged via `onHandoffRmm` / `onReturnRmm`
      // / `onHandoffMpd`. No per-frame override contribution.
      return null
    case 'spawn':
    case 'spawn-circular':
      // Spawn side-effects: bridged via `onSpawn` / `onSpawnCircular`.
      // Spawned ephemerals live entirely in the renderer.
      return null
  }
}

function breakScreenShake(n: EffectNode, localElapsed: number): CameraOverride | null {
  const shakeDurationMs = Math.max(1, n.params.shakeDurationMs ?? 300)
  if (localElapsed >= shakeDurationMs) return null
  const t = Math.min(1, localElapsed / shakeDurationMs)
  const decay = 1 - t
  const intensity = n.params.shakeIntensity ?? 8
  return {
    screenShakeX: Math.sin(localElapsed * 0.19) * intensity * decay,
    screenShakeY: Math.cos(localElapsed * 0.23) * intensity * decay,
  }
}

function hashNoise(seed: string, step: number): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= step
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff
}

/**
 * Per-frame additive camera contribution from a `camera` task. `ratio` 0–1.
 * Targets are interpreted as deltas relative to the user camera:
 *   panX/panY: scene-percent deltas, linearly interpolated 0 \u2192 target.
 *   zoom:     multiplicative scale factor (default 1 = no change),
 *             interpolated as 1 \u2192 zoom.
 */
function cameraContribution(n: EffectNode, ratio: number): CameraOverride | null {
  if (n.kind !== 'camera') return null
  const targetPanX = n.params.panX ?? 0
  const targetPanY = n.params.panY ?? 0
  const targetZoom = n.params.zoom ?? 1
  const dPanX = targetPanX * ratio
  const dPanY = targetPanY * ratio
  const scaleMul = 1 + (targetZoom - 1) * ratio
  if (dPanX === 0 && dPanY === 0 && scaleMul === 1) return null
  return { dPanX, dPanY, scaleMul }
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function phaseFor(seed: string, salt: number): number {
  const key = `${salt}|${seed}`
  const cached = phaseCache.get(key)
  if (cached != null) return cached
  let h = 2166136261 ^ salt
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const phase = ((h >>> 0) / 0xffffffff) * Math.PI * 2
  phaseCache.set(key, phase)
  if (phaseCache.size > PHASE_CACHE_LIMIT) {
    const first = phaseCache.keys().next().value as string | undefined
    if (first) phaseCache.delete(first)
  }
  return phase
}

function quantizedCycles(rawCycles: number, quantum: number): number {
  return Math.max(quantum, Math.round(rawCycles / quantum) * quantum)
}

function easeInCubic(t: number): number {
  return t * t * t
}
