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
import { spawnNested } from './spawnGrid'

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
