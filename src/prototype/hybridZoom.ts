export type HandoffMode = 'host' | 'child'

export interface HybridZoomSnapshot {
  progress: number
  cameraScale: number
  /** Canvas reveal factor (0→1): drives child-model height inside the node */
  nodeInflation: number
  /** Frame scale factor (1→2): the node itself grows via CSS transform */
  nodeScale: number
  handoffMode: HandoffMode
}

const MIN_PROGRESS = 0
const MAX_PROGRESS = 1
const DEFAULT_ZOOM_STEP = 0.08

/** Maximum canvas height in pixels when fully revealed inside the node */
export const CANVAS_MAX_HEIGHT = 160

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
    cameraScale: lerp(1, 2.5, normalized),
    // Canvas reveal factor: 0 = hidden, 1 = fully expanded.
    // This drives the child-model canvas height inside the node,
    // stretching the node frame as it grows.
    nodeInflation: normalized,
    // Node frame scale: the whole node grows to fill viewport.
    // Combined with camera zoom (2.5x * 2x = 5x), a 320px node
    // reaches ~1600px effective viewport width at full progress.
    nodeScale: lerp(1, 2, normalized),
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
