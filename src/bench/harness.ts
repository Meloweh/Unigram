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

export interface BenchResult {
  scenario: string
  durationMs: number
  frames: number
  fpsP50: number
  fpsP95: number
  fpsMin: number
  fpsMax: number
  fpsMean: number
}

export interface BenchOptions {
  durationMs?: number
}

type ScenarioFn = (renderer: SceneRenderer, t: number, dt: number) => void

const SCENARIOS: Record<string, ScenarioFn> = {
  /** Continuous horizontal pan at constant velocity. */
  'pan-h': (r, t) => {
    const cam = r.getCamera()
    const speed = 60 // scene-percent per second
    r.setCamera({ panX: Math.sin(t * 0.001) * 30, panY: cam.panY, freeScale: cam.freeScale })
    void speed
  },
  /** Pan diagonal in a small loop. */
  'pan-loop': (r, t) => {
    const cam = r.getCamera()
    r.setCamera({
      panX: Math.cos(t * 0.001) * 20,
      panY: Math.sin(t * 0.001) * 20,
      freeScale: cam.freeScale,
    })
  },
  /** Sinusoidal zoom in/out, no pan. */
  'zoom-pulse': (r, t) => {
    const cam = r.getCamera()
    const s = 1 + Math.sin(t * 0.002) * 0.5 // 0.5 .. 1.5
    r.setCamera({ panX: cam.panX, panY: cam.panY, freeScale: s })
  },
  /** Pan + zoom together (worst case for culling). */
  'pan-zoom': (r, t) => {
    const s = 1 + Math.sin(t * 0.002) * 0.4
    r.setCamera({
      panX: Math.cos(t * 0.001) * 25,
      panY: Math.sin(t * 0.001) * 25,
      freeScale: s,
    })
  },
  /** Idle — pure render-loop overhead. */
  idle: () => {
    /* no-op */
  },
}

export function listScenarios(): string[] {
  return Object.keys(SCENARIOS)
}

export async function runScenario(
  name: string,
  renderer: SceneRenderer,
  opts: BenchOptions = {},
): Promise<BenchResult> {
  const fn = SCENARIOS[name]
  if (!fn) throw new Error(`Unknown scenario: ${name}`)
  const durationMs = opts.durationMs ?? 3000

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
        fn(renderer, t, dt)
      } catch {
        /* scenario errors are logged by the caller */
      }
      if (t < durationMs) {
        requestAnimationFrame(tick)
      } else {
        resolve(summarize(name, durationMs, deltas))
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
    }
  }
  const fps = deltas.map((d) => 1000 / d).sort((a, b) => a - b)
  const p = (q: number) => fps[Math.min(fps.length - 1, Math.floor(fps.length * q))]
  const sum = fps.reduce((a, b) => a + b, 0)
  return {
    scenario: name,
    durationMs,
    frames: deltas.length,
    fpsP50: round(p(0.5)),
    fpsP95: round(p(0.95)),
    fpsMin: round(fps[0]),
    fpsMax: round(fps[fps.length - 1]),
    fpsMean: round(sum / fps.length),
  }
}

const round = (n: number) => Math.round(n * 10) / 10
