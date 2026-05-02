/**
 * Stage 5 flow effect schema (override-based, render-only).
 *
 * Each `FlowEffect` is a small DAG of `EffectNode`s (typed by `kind`) chained
 * by `EffectEdge`s. When played against a target diagram node, the runtime
 * spawns one *task* per node in topological order. Each task contributes a
 * per-frame `NodeOverride` for its target diagram node(s); the renderer
 * composes overrides on top of the base node positions/colors during draw.
 *
 * No DOM mutation, no cleanup bag, no `MutableRefObject`s — when a run
 * finishes (or is cancelled), the runtime drops the run id from a single
 * Map and the renderer immediately falls back to base values.
 *
 * The kind set is intentionally small for the first slice; new kinds plug in
 * as additional `Task` factories in `runtime.ts`.
 */

export type FlowEffectKind =
  | 'wait'
  | 'move'
  | 'scale'
  | 'color'
  | 'jitter'
  | 'float'
  | 'emerge'
  | 'dismiss'
  | 'cloud-levitate'
  | 'bubble-levitate'
  | 'repeater'

export interface EffectNode {
  id: string
  kind: FlowEffectKind
  /** Editor-only position (px). Ignored by the runtime. */
  x: number
  y: number
  /** Per-kind parameters. Shape depends on `kind`:
   *  - wait:             { ms }
   *  - move:             { dx, dy, ms, roundtrip? }   (relative offset, scene-percent;
   *                                                    roundtrip≠0 returns to origin)
   *  - scale:            { mul, ms, permanent? }     (final scale multiplier; permanent≠0 holds)
   *  - color:            { tint, ms, permanent? }     (Pixi tint hex; permanent≠0 holds final tint)
   *  - jitter:           { amp, ms }                  (sine wobble amplitude, scene-percent)
   *  - float:            { amp, ms, freq? }           (sinusoidal vertical hover; default freq 1 Hz)
   *  - emerge:           { ms, fromScale? }           (scale + alpha 0→1; default fromScale 0)
   *  - dismiss:          { ms, toScale? }             (scale + alpha 1→0; default toScale 0)
   *  - cloud-levitate:   { ampX, ampY, ms, freq? }    (X/Y phase-offset sin)
   *  - bubble-levitate:  { ampY, scaleAmp, ms, freq? }(vertical sin + scale pulse)
   *  - repeater:         { times }                    (when reached, rewinds the run;
   *                                                    times<0 means infinite, otherwise
   *                                                    decrements until exhausted. 0 contribution.)
   */
  params: Record<string, number>
}

export interface EffectEdge {
  from: string
  to: string
}

export interface FlowEffect {
  id: string
  label: string
  /** When true, the engine plays this effect on diagram load. */
  alwaysPlay?: boolean
  graph: {
    nodes: EffectNode[]
    edges: EffectEdge[]
  }
}

/**
 * Per-frame, per-target-node visual override aggregated from active tasks.
 * All fields are *additive* on top of the base `ModelNode`. The renderer
 * applies them after positioning the container at the base x/y.
 */
export interface NodeOverride {
  /** Extra offset in scene-percent units. */
  dx?: number
  dy?: number
  /** Multiplicative scale. 1 = no change. */
  scaleMul?: number
  /** Multiplicative alpha. 1 = no change. */
  alphaMul?: number
  /** Pixi tint (0xRRGGBB). 0xFFFFFF = no change. */
  tint?: number
}

/** Identity merge: two overrides combine multiplicatively. */
export function mergeOverride(a: NodeOverride, b: NodeOverride): NodeOverride {
  return {
    dx: (a.dx ?? 0) + (b.dx ?? 0),
    dy: (a.dy ?? 0) + (b.dy ?? 0),
    scaleMul: (a.scaleMul ?? 1) * (b.scaleMul ?? 1),
    alphaMul: (a.alphaMul ?? 1) * (b.alphaMul ?? 1),
    // Tint composition is multiplicative per channel.
    tint: tintCombine(a.tint ?? 0xffffff, b.tint ?? 0xffffff),
  }
}

function tintCombine(a: number, b: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff
  const r = Math.round((ar * br) / 255)
  const g = Math.round((ag * bg) / 255)
  const bl = Math.round((ab * bb) / 255)
  return (r << 16) | (g << 8) | bl
}
