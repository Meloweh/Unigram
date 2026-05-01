/**
 * Hybrid recursive-model (RMM) zoom math.
 *
 * Ported verbatim from the legacy build at `src/old/scene/hybridZoom.ts` —
 * the math has been the most thoroughly tested part of the legacy renderer
 * (see [hybridZoom.test.ts](../old/scene/hybridZoom.test.ts)) and this stage
 * keeps its contract.
 *
 * Two concurrent dimensions of progress:
 *   - `progress`     — overall transition 0→1 (drives camera scale).
 *   - `nodeProgress` — focused-node inflation 0→1 (drives the in-frame
 *                     reveal of the child model).
 *
 * They are normally lockstep, but a mid-transition focus swap lets
 * `nodeProgress` lag behind `progress` so the new node can catch up without
 * the camera lurching.
 */

export type HandoffMode = 'host' | 'child'

export interface HybridZoomSnapshot {
  progress: number
  nodeProgress: number
  cameraScale: number
  nodeInflation: number
  handoffMode: HandoffMode
}

const MIN = 0
const MAX = 1
export const DEFAULT_ZOOM_STEP = 0.08
export const CAMERA_SCALE_FINAL = 1.8

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function buildSnapshot(progress: number, nodeProgress?: number): HybridZoomSnapshot {
  const p = clamp(progress, MIN, MAX)
  const np = clamp(nodeProgress ?? p, MIN, MAX)
  return {
    progress: p,
    nodeProgress: np,
    cameraScale: lerp(1, CAMERA_SCALE_FINAL, p),
    nodeInflation: np,
    handoffMode: np >= 1 ? 'child' : 'host',
  }
}

export function applyZoomStep(
  snap: HybridZoomSnapshot,
  direction: 'in' | 'out',
  step = DEFAULT_ZOOM_STEP,
): HybridZoomSnapshot {
  if (direction === 'in') {
    if (snap.nodeProgress < snap.progress) {
      return buildSnapshot(snap.progress, snap.nodeProgress + step)
    }
    const next = snap.progress + step
    return buildSnapshot(next, next)
  }
  return buildSnapshot(snap.progress - step, snap.nodeProgress - step)
}

export function createInitialSnapshot(): HybridZoomSnapshot {
  return buildSnapshot(0, 0)
}

export function isAtRest(snap: HybridZoomSnapshot): boolean {
  return snap.progress === 0 && snap.nodeProgress === 0
}

export function isHandoffReady(snap: HybridZoomSnapshot): boolean {
  return snap.progress >= 1 && snap.nodeProgress >= 1
}
