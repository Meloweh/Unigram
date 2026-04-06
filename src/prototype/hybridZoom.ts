export type HandoffMode = 'host' | 'child'

export interface HybridZoomSnapshot {
  progress: number
  cameraScale: number
  /** Canvas reveal factor (0→1): drives actual pixel growth of the node canvas */
  nodeInflation: number
  handoffMode: HandoffMode
}

const MIN_PROGRESS = 0
const MAX_PROGRESS = 1
const DEFAULT_ZOOM_STEP = 0.08

/** Camera scale at full handoff. Exported so the viewport can compute target node size. */
export const CAMERA_SCALE_FINAL = 1.8

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export function buildSnapshot(progress: number): HybridZoomSnapshot {
  const normalized = clamp(progress, MIN_PROGRESS, MAX_PROGRESS)
  return {
    progress: normalized,
    cameraScale: lerp(1, CAMERA_SCALE_FINAL, normalized),
    // Canvas reveal factor: 0 = hidden, 1 = fully expanded.
    // The viewport uses this to grow node dimensions from base → (vpSize / cameraScale).
    // At handoff: actualNodeSize * cameraScale = viewportSize → canvas fills page.
    // Child model content at percentage positions = 100% canonical view.
    nodeInflation: normalized,
    handoffMode: normalized >= 1 ? 'child' : 'host',
  }
}

export function applyZoomStep(
  snapshot: HybridZoomSnapshot,
  direction: 'in' | 'out',
  step = DEFAULT_ZOOM_STEP,
): HybridZoomSnapshot {
  const delta = direction === 'in' ? step : -step
  return buildSnapshot(snapshot.progress + delta)
}

export function realignPanOffset(offset: { x: number; y: number }): { x: number; y: number } {
  return {
    x: offset.x * 0.82,
    y: offset.y * 0.82,
  }
}

export function createInitialSnapshot(): HybridZoomSnapshot {
  return buildSnapshot(0)
}
