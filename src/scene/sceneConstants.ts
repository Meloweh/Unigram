/**
 * Fixed virtual scene size. Node coordinates are stored as percentages
 * (0–100) of these dimensions so layouts are resolution-independent.
 * Same contract as legacy `src/old/scene/sceneConstants.ts`.
 */
export const SCENE_W = 1920
export const SCENE_H = 1080

/** LOD thresholds on `effectiveScale = cameraScale * freeScale`. */
export const LOD_FULL = 0.5
export const LOD_SIMPLE = 0.2

/** Free-zoom clamp range. */
export const FREE_ZOOM_MIN = 0.2
export const FREE_ZOOM_MAX = 5

/** Default snap-to-grid step in scene percent. */
export const DEFAULT_GRID_SNAP = 4

export interface CameraTransform {
  /** Pan offset in scene units (percent of SCENE_W / SCENE_H). */
  panX: number
  panY: number
  /** Free zoom multiplier. */
  freeScale: number
}

export interface ViewportSize {
  /** CSS pixel width / height of the host element. */
  width: number
  height: number
}

/** Convert a scene-percent coord to CSS pixels relative to the viewport. */
export function sceneToClient(
  sceneX: number,
  sceneY: number,
  camera: CameraTransform,
  viewport: ViewportSize,
): { x: number; y: number } {
  const scenePxX = (sceneX / 100) * SCENE_W
  const scenePxY = (sceneY / 100) * SCENE_H
  return {
    x: (scenePxX + camera.panX) * camera.freeScale + viewport.width / 2,
    y: (scenePxY + camera.panY) * camera.freeScale + viewport.height / 2,
  }
}

/** Convert a CSS pixel coord (relative to viewport top-left) to scene percent. */
export function clientToScene(
  clientX: number,
  clientY: number,
  camera: CameraTransform,
  viewport: ViewportSize,
): { x: number; y: number } {
  const scenePxX = (clientX - viewport.width / 2) / camera.freeScale - camera.panX
  const scenePxY = (clientY - viewport.height / 2) / camera.freeScale - camera.panY
  return {
    x: (scenePxX / SCENE_W) * 100,
    y: (scenePxY / SCENE_H) * 100,
  }
}

export interface SceneAabb {
  /** Min/max in scene percent. */
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Visible scene rectangle in scene-percent units. */
export function visibleSceneAabb(
  camera: CameraTransform,
  viewport: ViewportSize,
  paddingPercent = 0,
): SceneAabb {
  const tl = clientToScene(0, 0, camera, viewport)
  const br = clientToScene(viewport.width, viewport.height, camera, viewport)
  return {
    minX: tl.x - paddingPercent,
    minY: tl.y - paddingPercent,
    maxX: br.x + paddingPercent,
    maxY: br.y + paddingPercent,
  }
}
