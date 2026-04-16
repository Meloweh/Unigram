export type HandoffMode = 'host' | 'child'

export interface HybridZoomSnapshot {
  progress: number
  /** Node-specific zoom progress; may lag behind progress after a mid-zoom node switch */
  nodeProgress: number
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

/**
 * Build a snapshot from overall progress and (optionally separate) node progress.
 * When nodeProgress is omitted it defaults to progress (in-sync).
 */
export function buildSnapshot(progress: number, nodeProgress?: number): HybridZoomSnapshot {
  const p = clamp(progress, MIN_PROGRESS, MAX_PROGRESS)
  const np = clamp(nodeProgress ?? p, MIN_PROGRESS, MAX_PROGRESS)
  return {
    progress: p,
    nodeProgress: np,
    cameraScale: lerp(1, CAMERA_SCALE_FINAL, p),
    nodeInflation: np,
    handoffMode: np >= 1 ? 'child' : 'host',
  }
}

export function applyZoomStep(
  snapshot: HybridZoomSnapshot,
  direction: 'in' | 'out',
  step = DEFAULT_ZOOM_STEP,
): HybridZoomSnapshot {
  if (direction === 'in') {
    if (snapshot.nodeProgress < snapshot.progress) {
      // Node catching up after a mid-zoom switch — only inflate, camera holds
      return buildSnapshot(snapshot.progress, snapshot.nodeProgress + step)
    }
    const next = snapshot.progress + step
    return buildSnapshot(next, next)
  }
  // Zoom out: reduce both together
  return buildSnapshot(snapshot.progress - step, snapshot.nodeProgress - step)
}

export function realignPanOffset(offset: { x: number; y: number }): { x: number; y: number } {
  return {
    x: offset.x * 0.82,
    y: offset.y * 0.82,
  }
}

export function createInitialSnapshot(): HybridZoomSnapshot {
  return buildSnapshot(0, 0)
}
