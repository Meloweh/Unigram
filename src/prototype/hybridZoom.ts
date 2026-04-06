export type HandoffMode = 'host' | 'child'

export interface HybridZoomSnapshot {
  progress: number
  cameraScale: number
  nodeInflation: number
  handoffMode: HandoffMode
}

const MIN_PROGRESS = 0
const MAX_PROGRESS = 1
const DEFAULT_ZOOM_STEP = 0.08

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
    cameraScale: lerp(1, 1.45, normalized),
    nodeInflation: lerp(1, 2.35, normalized),
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
