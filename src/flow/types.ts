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
  | 'camera'
  | 'break'
  | 'text-format'
  | 'text-generator'
  | 'record'
  | 'obs-record'
  | 'handoff-rmm'
  | 'return-rmm'
  | 'handoff-mpd'
  | 'spawn'
  | 'spawn-circular'
  | 'expand'
  | 'collapse'

export interface SpawnItem {
  label: string
  offsetX: number
  offsetY: number
  animation: 'emerge' | 'zip-in'
  connectionType: 'none' | 'default' | 'flow'
}

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
   *  - jitter:           { intensity, ms }            (legacy-style random burst, screen px)
   *  - float:            { amp, ms, freq? }           (sinusoidal vertical hover; default freq 1 Hz)
   *  - emerge:           { ms, fromScale?,            (scale + alpha 0→1; default fromScale 0.
   *                         animation?, fromDx?,       animation=0 emerges from incoming source,
   *                         fromDy? }                  animation=1 center scale, animation=2 fade)
   *  - dismiss:          { ms, toScale? }             (scale + alpha 1→0; default toScale 0)
  *  - cloud-levitate:   { ampX, ampY, rotAmp?, speed?, ms }
   *                                                    (prototype-style X/Y drift + sway)
   *  - bubble-levitate:  { ampX?, ampY, scaleAmp, speed?, ms, scalePulse? }
    *                                                    (prototype-style X/Y drift + scale pulse)
   *  - repeater:         { repeatCount }              (routes its circuit output N times,
   *                                                    then exits through the default output.
   *                                                    0 contribution.)
   *  - camera:           { panX?, panY?, zoom?, ms,    (drives the renderer's camera as a
   *                        permanent? }                 transient additive override; panX/panY in
   *                                                    scene-percent deltas, zoom multiplicative.
   *                                                    permanent≠0 holds final values until the run
   *                                                    cancels. Does NOT mutate the store.)
    *  - break:            { axis, shakeIntensity, shakeDurationMs, fallDurationMs, ms }
    *                                                    (shake, then fall/fly apart)
    *  - text-format:      { startIndex?, endIndex?, bold?, italic?,
   *                         strikethrough?, tint?, fontSize?, ms,
   *                         formatMode? }              (formatMode=1 keeps the format
   *                                                    alive for downstream text generators.)
   *  - text-generator:   { charsPerSec?, sound?, loop?,(progressive label reveal on the target
   *                        endHoldMs? }                 node. Resolves text from the node's label.
   *                                                    `sound` is the index into TEXT_GEN_SOUND_PRESETS;
   *                                                    -1 = none. Bridged to TextGenRunner via the
   *                                                    runtime's `onTextGen` callback so the renderer
   *                                                    owns the actual reveal state.)
   */
  params: Record<string, number>
  /** Legacy spawn facade definitions. Runtime activates matching preview nodes. */
  spawnItems?: SpawnItem[]
  /** Optional editor-visible label. Runtime ignores it. */
  label?: string
}

export interface EffectEdge {
  from: string
  to: string
  /** Repeater-only output routing. Missing means the normal default output. */
  fromPort?: 'default' | 'circuit'
  /** Editor-only input port for repeater nodes. Missing means default. */
  toPort?: 'default' | 'circuit'
}

export interface FlowEffect {
  id: string
  label: string
  /** Built-in effect owned by a semantic node type; editor should preserve it. */
  locked?: boolean
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
  /** Additive rotation in degrees. */
  rotationDeg?: number
  /** Multiplicative alpha. 1 = no change. */
  alphaMul?: number
  /** Pixi tint (0xRRGGBB). 0xFFFFFF = no change. */
  tint?: number
  /** Render the target as two falling masked halves instead of one whole node. */
  breakApart?: BreakApartOverride
  /** 0→1 while an emerge task is revealing this node; used by incoming edges. */
  emergeProgress?: number
}

export interface BreakApartOverride {
  axis: 'horizontal' | 'vertical'
  shakeX: number
  shakeY: number
  fallRatio: number
}

/** Identity merge: two overrides combine multiplicatively. */
export function mergeOverride(a: NodeOverride, b: NodeOverride): NodeOverride {
  return {
    dx: (a.dx ?? 0) + (b.dx ?? 0),
    dy: (a.dy ?? 0) + (b.dy ?? 0),
    scaleMul: (a.scaleMul ?? 1) * (b.scaleMul ?? 1),
    rotationDeg: (a.rotationDeg ?? 0) + (b.rotationDeg ?? 0),
    alphaMul: (a.alphaMul ?? 1) * (b.alphaMul ?? 1),
    // Tint composition is multiplicative per channel.
    tint: tintCombine(a.tint ?? 0xffffff, b.tint ?? 0xffffff),
    breakApart: b.breakApart ?? a.breakApart,
    emergeProgress: b.emergeProgress ?? a.emergeProgress,
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

/**
 * Per-frame camera adjustment from active `camera` flow tasks. Composed
 * additively on top of the user camera by `SceneRenderer.applyCameraTransform`.
 * Kept separate from `NodeOverride` because it's global, not per-target.
 */
export interface CameraOverride {
  /** Extra pan in scene-percent units, additive on top of `camera.panX`. */
  dPanX?: number
  dPanY?: number
  /** Multiplicative zoom on top of `camera.freeScale`. 1 = no change. */
  scaleMul?: number
  /** Screen-space shake in CSS pixels, applied after world scaling. */
  screenShakeX?: number
  screenShakeY?: number
}

export function mergeCameraOverride(
  a: CameraOverride,
  b: CameraOverride,
): CameraOverride {
  return {
    dPanX: (a.dPanX ?? 0) + (b.dPanX ?? 0),
    dPanY: (a.dPanY ?? 0) + (b.dPanY ?? 0),
    scaleMul: (a.scaleMul ?? 1) * (b.scaleMul ?? 1),
    screenShakeX: (a.screenShakeX ?? 0) + (b.screenShakeX ?? 0),
    screenShakeY: (a.screenShakeY ?? 0) + (b.screenShakeY ?? 0),
  }
}
