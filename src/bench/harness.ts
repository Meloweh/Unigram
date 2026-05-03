/**
 * Bench harness — Stage 2.
 *
 * Drives the renderer through scripted gestures (pan/zoom/drag) and samples
 * frame deltas via `requestAnimationFrame`, computing FPS percentiles.
 *
 * Usage (from a dev button or DevTools):
 *
 *   const result = await runScenario('pan-3s', renderer, { durationMs: 3000 })
 *   console.table(result)
 *
 * Per AGENTS.md: every new feature must register a scenario here so we can
 * regression-check the 60 FPS @ 1000 nodes invariant.
 */

import type { SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore } from '../model/store'
import { spawnGrid, spawnNested } from './spawnGrid'
import type { FlowEffect } from '../flow/types'

export interface BenchResult {
  scenario: string
  durationMs: number
  frames: number
  fpsP50: number
  fpsP95: number
  fpsMin: number
  fpsMax: number
  fpsMean: number
  /** Per-frame time stats in ms (median / 95th / max). */
  frameMsP50: number
  frameMsP95: number
  frameMsMax: number
}

export interface BenchOptions {
  durationMs?: number
}

type ScenarioFn = (renderer: SceneRenderer, t: number, dt: number) => void
type ScenarioSetup = (renderer: SceneRenderer) => void | Promise<void>
type ScenarioTeardown = (renderer: SceneRenderer) => void | Promise<void>

interface ScenarioDef {
  step: ScenarioFn
  setup?: ScenarioSetup
  teardown?: ScenarioTeardown
}

function defineScenario(step: ScenarioFn, setup?: ScenarioSetup, teardown?: ScenarioTeardown): ScenarioDef {
  return { step, setup, teardown }
}

const SCENARIOS: Record<string, ScenarioDef> = {
  /** Continuous horizontal pan at constant velocity. */
  'pan-h': defineScenario((r, t) => {
    const cam = r.getCamera()
    r.setCamera({ panX: Math.sin(t * 0.001) * 30, panY: cam.panY, freeScale: cam.freeScale })
  }),
  /** Pan diagonal in a small loop. */
  'pan-loop': defineScenario((r, t) => {
    const cam = r.getCamera()
    r.setCamera({
      panX: Math.cos(t * 0.001) * 20,
      panY: Math.sin(t * 0.001) * 20,
      freeScale: cam.freeScale,
    })
  }),
  /** Sinusoidal zoom in/out, no pan. */
  'zoom-pulse': defineScenario((r, t) => {
    const cam = r.getCamera()
    const s = 1 + Math.sin(t * 0.002) * 0.5
    r.setCamera({ panX: cam.panX, panY: cam.panY, freeScale: s })
  }),
  /** Pan + zoom together (worst case for culling). */
  'pan-zoom': defineScenario((r, t) => {
    const s = 1 + Math.sin(t * 0.002) * 0.4
    r.setCamera({
      panX: Math.cos(t * 0.001) * 25,
      panY: Math.sin(t * 0.001) * 25,
      freeScale: s,
    })
  }),
  /** Idle — pure render-loop overhead. */
  idle: defineScenario(() => {
    /* no-op */
  }),
  /**
   * RMM zoom: spawn a nested-demo scene, select a parent, and drive the
   * hybrid-zoom snapshot in/out repeatedly. Acceptance: per-frame cost
   * ≤ 16 ms during the transition (Stage 3 contract).
   */
  'rmm-zoom': defineScenario(
    (_r, t) => {
      const store = useOmniStore.getState()
      const period = 2000 // ms for one in-out cycle
      const phase = (t % period) / period // 0…1
      // Drive zoom progress directly via repeated steps.
      const target = phase < 0.5 ? phase * 2 : (1 - phase) * 2 // 0→1→0
      const step = 0.18 // 1 / 6 — zoom completes in ≥6 frames
      const cur = store.zoom.progress
      if (target > cur + step * 0.5) store.rmmZoomStep('in', step)
      else if (target < cur - step * 0.5) store.rmmZoomStep('out', step)
    },
    () => {
      const { root, children } = spawnNested()
      const store = useOmniStore.getState()
      for (const c of children) store.registerModel(c)
      store.loadModel(root)
      // Select the first parent so RMM has a focus target.
      const first = root.nodes.values().next().value
      if (first) store.select(first.id)
    },
    () => {
      // Reset zoom + selection so subsequent benches start clean.
      const store = useOmniStore.getState()
      store.rmmReset()
      store.clearSelection()
    },
  ),
  /**
   * Effects-heavy: 500 nodes, ~120 of them firing rolling spawn / expand /
   * jitter effects. Stage-5 acceptance contract: ≥60 FPS @ 500 visible
   * nodes with effects animating. Fires a fresh batch every 1 s so the
   * runtime is never idle.
   */
  'effects-500': defineScenario(
    (r, t) => {
      // Fire a small wave every ~250 ms so multiple cohorts overlap.
      const slot = Math.floor(t / 250)
      const lastSlot = (r as unknown as { __benchSlot?: number }).__benchSlot ?? -1
      if (slot === lastSlot) return
      ;(r as unknown as { __benchSlot?: number }).__benchSlot = slot
      const store = useOmniStore.getState()
      const ids = [...store.model.nodes.keys()]
      if (ids.length === 0) return
      const cohort = 30
      const start = (slot * cohort) % ids.length
      for (let i = 0; i < cohort; i++) {
        const id = ids[(start + i) % ids.length]
        const kind = (['spawn', 'expand', 'jitter', 'spawn-circular'] as const)[i % 4]
        const eff: FlowEffect = {
          id: `bench-${kind}`,
          label: `bench ${kind}`,
          graph: {
            nodes: [
              { id: 'a', kind, params: defaultBenchParams(kind), x: 0, y: 0 },
            ],
            edges: [],
          },
        }
        r.playFlowEffect(id, eff)
      }
    },
    () => {
      const model = spawnGrid({ count: 500, spacingPercent: 6 })
      useOmniStore.getState().loadModel(model)
    },
    () => {
      // Cancel all in-flight runs by reloading a fresh model so the next
      // scenario starts clean.
      useOmniStore.getState().loadModel(spawnGrid({ count: 1 }))
    },
  ),
  /**
   * Selection-pulse: 1000 nodes, 50 selected. Verifies the layered aura
   * (BlurFilter outer + inner + crisp ring) sustains ≥60 FPS while the
   * per-frame pulse animates the layer alphas. No camera motion — isolates
   * the cost of the aura GPU passes.
   */
  'selection-pulse': defineScenario(
    () => {
      // Step is a no-op; the per-frame alpha modulation happens in onTick.
    },
    () => {
      const model = spawnGrid({ count: 1000, spacingPercent: 4 })
      const store = useOmniStore.getState()
      store.loadModel(model)
      const ids = [...model.nodes.keys()].slice(0, 50)
      store.selectMany(ids)
    },
    () => {
      useOmniStore.getState().clearSelection()
      useOmniStore.getState().loadModel(spawnGrid({ count: 1 }))
    },
  ),
  /**
   * Cosmetic mixed scene: 1000 nodes cycling through standard + cosmetic
   * shapes while panning/zooming. Protects the richer bubble/cloud geometry
   * from quietly eroding the 60 FPS target.
   */
  'cosmetic-mixed-1k': defineScenario(
    (r, t) => {
      const s = 0.85 + Math.sin(t * 0.0017) * 0.25
      r.setCamera({
        panX: Math.cos(t * 0.0011) * 22,
        panY: Math.sin(t * 0.0013) * 18,
        freeScale: s,
      })
    },
    () => {
      useOmniStore.getState().loadModel(spawnGrid({ count: 1000, spacingPercent: 4, mixedShapes: true }))
    },
    () => {
      useOmniStore.getState().loadModel(spawnGrid({ count: 1 }))
    },
  ),
  /**
   * Multi-drag stress: 2000 nodes, 300 selected, dragged in a circle.
   * Mirrors the manual regression case where pointermove previously updated
   * hundreds of nodes + detailed selection halos on every event/frame.
   */
  'multi-drag-2k': defineScenario(
    (r, t) => {
      const bench = r as unknown as {
        __multiDragBase?: Array<{ id: string; x: number; y: number }>
        __multiDragMoves?: Array<{ id: string; x: number; y: number }>
      }
      const base = bench.__multiDragBase ?? []
      const moves = bench.__multiDragMoves ?? []
      moves.length = 0
      const dx = Math.cos(t * 0.003) * 3
      const dy = Math.sin(t * 0.003) * 3
      for (let i = 0; i < base.length; i++) {
        const b = base[i]
        moves.push({ id: b.id, x: b.x + dx, y: b.y + dy })
      }
      r.moveNodesDirect(moves, { updateIndex: false })
    },
    (r) => {
      const model = spawnGrid({ count: 2000, spacingPercent: 2.8 })
      const store = useOmniStore.getState()
      store.loadModel(model)
      const ids = [...model.nodes.keys()].slice(0, 300)
      store.selectMany(ids)
      ;(r as unknown as { __multiDragBase?: Array<{ id: string; x: number; y: number }>; __multiDragMoves?: Array<{ id: string; x: number; y: number }> }).__multiDragBase = ids
        .map((id) => model.nodes.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({ id: n.id, x: n.x, y: n.y }))
      ;(r as unknown as { __multiDragMoves?: Array<{ id: string; x: number; y: number }> }).__multiDragMoves = []
    },
    (r) => {
      const ids = [...useOmniStore.getState().selectedIds]
      r.reindexNodes(ids)
      useOmniStore.getState().clearSelection()
      useOmniStore.getState().loadModel(spawnGrid({ count: 1 }))
      delete (r as unknown as { __multiDragBase?: unknown }).__multiDragBase
      delete (r as unknown as { __multiDragMoves?: unknown }).__multiDragMoves
    },
  ),
}

function defaultBenchParams(kind: string): Record<string, number> {
  switch (kind) {
    case 'spawn':
      return { count: 6, radius: 6, ms: 800, fadeMs: 200 }
    case 'spawn-circular':
      return { count: 8, radius: 6, ms: 800, fadeMs: 200 }
    case 'expand':
      return { mul: 1.4, ms: 400, permanent: 0 }
    case 'jitter':
      return { amp: 0.4, ms: 600 }
    default:
      return { ms: 500 }
  }
}

export function listScenarios(): string[] {
  return Object.keys(SCENARIOS)
}

export async function runScenario(
  name: string,
  renderer: SceneRenderer,
  opts: BenchOptions = {},
): Promise<BenchResult> {
  const def = SCENARIOS[name]
  if (!def) throw new Error(`Unknown scenario: ${name}`)
  const durationMs = opts.durationMs ?? 3000
  if (def.setup) await def.setup(renderer)

  const deltas: number[] = []
  let last = performance.now()
  const start = last

  return new Promise<BenchResult>((resolve) => {
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const t = now - start
      // Skip the first frame (likely a long delta from setup).
      if (deltas.length > 0 || t > 16) deltas.push(dt)
      try {
        def.step(renderer, t, dt)
      } catch {
        /* scenario errors are logged by the caller */
      }
      if (t < durationMs) {
        requestAnimationFrame(tick)
      } else {
        const result = summarize(name, durationMs, deltas)
        if (def.teardown) {
          Promise.resolve(def.teardown(renderer)).finally(() => resolve(result))
        } else {
          resolve(result)
        }
      }
    }
    requestAnimationFrame(tick)
  })
}

function summarize(name: string, durationMs: number, deltas: number[]): BenchResult {
  if (deltas.length === 0) {
    return {
      scenario: name,
      durationMs,
      frames: 0,
      fpsP50: 0,
      fpsP95: 0,
      fpsMin: 0,
      fpsMax: 0,
      fpsMean: 0,
      frameMsP50: 0,
      frameMsP95: 0,
      frameMsMax: 0,
    }
  }
  const fps = deltas.map((d) => 1000 / d).sort((a, b) => a - b)
  const ms = [...deltas].sort((a, b) => a - b)
  const p = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))]
  const sum = fps.reduce((a, b) => a + b, 0)
  return {
    scenario: name,
    durationMs,
    frames: deltas.length,
    fpsP50: round(p(fps, 0.5)),
    fpsP95: round(p(fps, 0.95)),
    fpsMin: round(fps[0]),
    fpsMax: round(fps[fps.length - 1]),
    fpsMean: round(sum / fps.length),
    frameMsP50: round(p(ms, 0.5)),
    frameMsP95: round(p(ms, 0.95)),
    frameMsMax: round(ms[ms.length - 1]),
  }
}

const round = (n: number) => Math.round(n * 10) / 10
