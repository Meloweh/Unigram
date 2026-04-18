/** Fixed scene dimensions — decouples scene space from viewport size */
export const SCENE_W = 1920
export const SCENE_H = 1080
export const SCENE_VP = { w: SCENE_W, h: SCENE_H } as const

/** Minimum base dimensions fallback before label measured */
export const NODE_MIN_W = 80
export const NODE_MIN_H = 40

/** Auto-expand grid chunk size in percentage units */
export const GRID_CHUNK = 20

/** Level-of-detail thresholds (based on effectiveScale) */
export const LOD_FULL = 0.5    // full SceneNode render
export const LOD_SIMPLE = 0.2  // simplified colored rect + label
// Below LOD_SIMPLE: colored dot only

/** Cache AudioContext + AnalyserNode per media element so createMediaElementSource is only called once */
export const audioCtxCache = new WeakMap<HTMLMediaElement, { ctx: AudioContext; analyser: AnalyserNode }>()

import type { ModelNode } from '../model/sampleModels'

/** Compute the dynamic grid extent from node positions (draw.io-style auto-expand).
 *  Extends in GRID_CHUNK increments beyond 0-100 when nodes are outside, shrinks when freed. */
export function computeGridExtent(nodes: ModelNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  let nMinX = Infinity, nMinY = Infinity, nMaxX = -Infinity, nMaxY = -Infinity
  for (const n of nodes) {
    nMinX = Math.min(nMinX, n.x)
    nMinY = Math.min(nMinY, n.y)
    nMaxX = Math.max(nMaxX, n.x)
    nMaxY = Math.max(nMaxY, n.y)
  }
  return {
    minX: Math.min(0, Math.floor(nMinX / GRID_CHUNK) * GRID_CHUNK),
    minY: Math.min(0, Math.floor(nMinY / GRID_CHUNK) * GRID_CHUNK),
    maxX: Math.max(100, Math.ceil(nMaxX / GRID_CHUNK) * GRID_CHUNK),
    maxY: Math.max(100, Math.ceil(nMaxY / GRID_CHUNK) * GRID_CHUNK),
  }
}
