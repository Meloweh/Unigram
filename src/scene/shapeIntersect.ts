/**
 * Ray-vs-shape intersection for connection anchoring.
 *
 * Given a node centred at the origin with half-dimensions (hw, hh) and a ray
 * direction (dx, dy), returns the point where the ray exits the node's
 * visual boundary. Used by `EdgePool` to keep arrow heads from sinking into
 * nodes — the line is shortened to land exactly on the shape outline.
 *
 * Ported from `src/old/scene/edgeAnchoring.ts::shapeEdgeIntersect`. The
 * algorithm is unchanged; the file is moved out of the legacy tree so new
 * code can import it without touching `src/old/`.
 */

import type { NodeShape } from './shapes'
import { thinkingCloudOutlinePoints } from './cosmeticGeometry'

const POLYGONS: Partial<Record<NodeShape, (hw: number, hh: number) => Array<[number, number]>>> = {
  diamond: (hw, hh) => [[0, -hh], [hw, 0], [0, hh], [-hw, 0]],
  hexagon: (hw, hh) => [
    [-hw / 2, -hh],
    [hw / 2, -hh],
    [hw, 0],
    [hw / 2, hh],
    [-hw / 2, hh],
    [-hw, 0],
  ],
  parallelogram: (hw, hh) => [[-0.7 * hw, -hh], [hw, -hh], [0.7 * hw, hh], [-hw, hh]],
  triangle: (hw, hh) => [[0, -hh], [hw, hh], [-hw, hh]],
}

/** Returns intersection point relative to node centre. */
export function shapeEdgeIntersect(
  shape: NodeShape,
  hw: number,
  hh: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  if (shape === 'thinking-cloud') {
    const hit = rayPolygonIntersect(thinkingCloudOutlinePoints(hw * 2, hh * 2, 4), dx, dy)
    if (hit) return hit
  }

  // Oval/circle boundaries use the exact ellipse intersection.
  if (shape === 'oval' || shape === 'circle') {
    const denom = Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
    if (denom < 1e-9) return { x: 0, y: 0 }
    return { x: dx / denom, y: dy / denom }
  }

  const polyFn = POLYGONS[shape]
  if (polyFn) {
    const poly = polyFn(hw, hh)
    let bestT = Infinity
    for (let i = 0; i < poly.length; i++) {
      const [p1x, p1y] = poly[i]
      const [p2x, p2y] = poly[(i + 1) % poly.length]
      const ex = p2x - p1x
      const ey = p2y - p1y
      const det = dy * ex - dx * ey
      if (Math.abs(det) < 1e-12) continue
      const t = (p1y * ex - p1x * ey) / det
      const u = (dx * p1y - dy * p1x) / det
      if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) bestT = t
    }
    if (bestT < Infinity) return { x: dx * bestT, y: dy * bestT }
  }

  // Fallback for rectangle / rounded-rect / chat-bubble / unknown: AA rect.
  const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty)
  return { x: dx * t, y: dy * t }
}

function rayPolygonIntersect(poly: Array<[number, number]>, dx: number, dy: number): { x: number; y: number } | null {
  let bestT = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [p1x, p1y] = poly[i]
    const [p2x, p2y] = poly[(i + 1) % poly.length]
    const ex = p2x - p1x
    const ey = p2y - p1y
    const det = dy * ex - dx * ey
    if (Math.abs(det) < 1e-12) continue
    const t = (p1y * ex - p1x * ey) / det
    const u = (dx * p1y - dy * p1x) / det
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) bestT = t
  }
  return bestT < Infinity ? { x: dx * bestT, y: dy * bestT } : null
}
