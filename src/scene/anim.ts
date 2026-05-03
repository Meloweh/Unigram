/**
 * Tiny pure-function animation primitives shared by the scene renderer.
 *
 * Intentionally minimal: just easings and a periodic phase helper. The
 * renderer drives the per-frame tick; nothing here owns state. Avoids
 * pulling in a generic animation engine (would conflict with the
 * "implementationDiscipline" guideline in AGENTS.md).
 */

const TWO_PI = Math.PI * 2

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function easeOutCubic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const u = 1 - t
  return 1 - u * u * u
}

export function easeInOutSine(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 0.5 - 0.5 * Math.cos(t * Math.PI)
}

/**
 * Triangle/sine wave in [0, 1] with the given period in ms. `now` is a
 * monotonic timestamp (e.g. `performance.now()`). Smooth (cosine-based) so
 * looped alpha/scale modulation looks like breathing rather than a sawtooth.
 */
export function pulse01(now: number, periodMs: number): number {
  if (periodMs <= 0) return 0
  const phase = ((now % periodMs) / periodMs) * TWO_PI
  return 0.5 - 0.5 * Math.cos(phase)
}

/** Linear phase in [0, 1) advancing every `periodMs`. */
export function loopPhase(now: number, periodMs: number): number {
  if (periodMs <= 0) return 0
  return (now % periodMs) / periodMs
}
