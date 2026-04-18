import type { ModelNode, ModelConnection } from '../model/sampleModels'

/* ---- Edge-anchored connection helpers ---- */

export type Edge = 'top' | 'right' | 'bottom' | 'left'

export interface Anchor { fx: number; fy: number; tx: number; ty: number }

/** Minimum base dimensions fallback before label measured */
const NODE_MIN_W = 80
const NODE_MIN_H = 40

/** Estimate the pixel size of a child-scene-node from its label.
 *  CSS: padding 10px 16px, border 2px, font ~0.95rem 600 */
export function estimateNodePx(label: string): { w: number; h: number } {
  const charW = 8.5
  const lineH = 20
  const padX = 36 // 16*2 padding + 2*2 border
  const padY = 32 // 14*2 padding + 2*2 border (matches measureLabel vPad=28+4)
  const trimmed = label.replace(/\n+$/, '')
  const lines = trimmed ? trimmed.split('\n') : ['']
  const maxLineLen = Math.max(...lines.map((l) => l.length), 1)
  return {
    w: Math.max(NODE_MIN_W, maxLineLen * charW + padX),
    h: Math.max(NODE_MIN_H, lines.length * lineH + padY),
  }
}

/** Which edge of a rectangle (in pixel half-dims) does a direction vector exit through? */
export function dominantEdge(
  hw: number, hh: number,
  dxPx: number, dyPx: number,
): Edge {
  // Time to reach each edge along the ray
  const tx = hw / (Math.abs(dxPx) || 1e-9)
  const ty = hh / (Math.abs(dyPx) || 1e-9)
  if (tx < ty) return dxPx > 0 ? 'right' : 'left'
  return dyPx > 0 ? 'bottom' : 'top'
}

/** Find where a ray from origin in direction (dx, dy) exits a node shape.
 *  Returns a point relative to the node center. hw/hh are half-dimensions. */
export function shapeEdgeIntersect(
  shape: string | undefined,
  hw: number, hh: number,
  dx: number, dy: number,
  cosmeticType?: string,
): { x: number; y: number } {
  const s = shape ?? 'rounded-rect'

  // Cosmetic: thinking-cloud uses elliptical boundary (like oval)
  if (cosmeticType === 'thinking-cloud') {
    const denom = Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
    if (denom < 1e-9) return { x: 0, y: 0 }
    return { x: dx / denom, y: dy / denom }
  }

  // Cosmetic: chat-bubble uses rect boundary (tip extends beyond, connections attach to body)
  if (cosmeticType === 'chat-bubble') {
    const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity
    const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity
    const t = Math.min(tx, ty)
    return { x: dx * t, y: dy * t }
  }

  // Elliptical shapes
  if (s === 'oval' || s === 'circle') {
    const denom = Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh))
    if (denom < 1e-9) return { x: 0, y: 0 }
    return { x: dx / denom, y: dy / denom }
  }

  // Polygon shapes
  const polygons: Record<string, [number, number][]> = {
    diamond: [[0, -hh], [hw, 0], [0, hh], [-hw, 0]],
    hexagon: [[-hw / 2, -hh], [hw / 2, -hh], [hw, 0], [hw / 2, hh], [-hw / 2, hh], [-hw, 0]],
    parallelogram: [[-0.7 * hw, -hh], [hw, -hh], [0.7 * hw, hh], [-hw, hh]],
    triangle: [[0, -hh], [hw, hh], [-hw, hh]],
  }
  const poly = polygons[s]
  if (!poly) {
    // Rectangle / rounded-rect: intersect with axis-aligned rect
    const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity
    const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity
    const t = Math.min(tx, ty)
    return { x: dx * t, y: dy * t }
  }

  // Ray-convex-polygon intersection (smallest positive t)
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
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) {
      bestT = t
    }
  }
  if (bestT < Infinity) {
    return { x: dx * bestT, y: dy * bestT }
  }
  // Fallback: rect boundary
  const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty)
  return { x: dx * t, y: dy * t }
}

/** SVG polygon points string for a shape. w/h are total node dimensions. */
export function shapeSvgPoints(shape: string, w: number, h: number): string {
  switch (shape) {
    case 'diamond': return `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`
    case 'hexagon': return `${w * 0.25},0 ${w * 0.75},0 ${w},${h / 2} ${w * 0.75},${h} ${w * 0.25},${h} 0,${h / 2}`
    case 'parallelogram': return `${w * 0.15},0 ${w},0 ${w * 0.85},${h} 0,${h}`
    case 'triangle': return `${w / 2},0 ${w},${h} 0,${h}`
    default: return ''
  }
}

/** Standard 2D cross product of vectors (b-a) × (c-a) */
export function cross2d(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** Do the open segments (a→b) and (c→d) properly intersect? (ignores shared endpoints & collinear) */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross2d(cx, cy, dx, dy, ax, ay)
  const d2 = cross2d(cx, cy, dx, dy, bx, by)
  const d3 = cross2d(ax, ay, bx, by, cx, cy)
  const d4 = cross2d(ax, ay, bx, by, dx, dy)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

/** Count the number of segment crossings among connections. */
export function countCrossings(
  nodes: ModelNode[],
  connections: ModelConnection[],
  posOf: (id: string) => { x: number; y: number },
): number {
  let count = 0
  for (let i = 0; i < connections.length; i++) {
    const c1 = connections[i]
    const a = posOf(c1.from), b = posOf(c1.to)
    for (let j = i + 1; j < connections.length; j++) {
      const c2 = connections[j]
      if (c1.from === c2.from || c1.from === c2.to ||
          c1.to === c2.from || c1.to === c2.to) continue
      const c = posOf(c2.from), d = posOf(c2.to)
      if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) count++
    }
  }
  return count
}

/** Does the segment (a→b) intersect the axis-aligned rectangle
 *  centered at (cx,cy) with half-dims (hw,hh)? Uses Liang-Barsky clipping. */
export function segmentIntersectsRect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, hw: number, hh: number,
): boolean {
  const dx = bx - ax, dy = by - ay
  const px = [-dx, dx, -dy, dy]
  const qx = [ax - (cx - hw), (cx + hw) - ax, ay - (cy - hh), (cy + hh) - ay]
  let tMin = 0, tMax = 1
  for (let i = 0; i < 4; i++) {
    if (Math.abs(px[i]) < 1e-9) {
      if (qx[i] < 0) return false
    } else {
      const t = qx[i] / px[i]
      if (px[i] < 0) { if (t > tMax) return false; if (t > tMin) tMin = t }
      else            { if (t < tMin) return false; if (t < tMax) tMax = t }
    }
  }
  return tMin < tMax
}

/** Compute edge-anchored endpoints for every connection.
 *  Returns a map from connectionKey to { fx, fy, tx, ty } in percentage coords. */
export function computeEdgeAnchors(
  nodes: ModelNode[],
  connections: ModelConnection[],
  vpW: number, vpH: number,
  posOf: (n: ModelNode) => { x: number; y: number },
  nodeSizes?: Map<string, { w: number; h: number }>,
): Record<string, Anchor> {
  const nodeMap = new Map<string, ModelNode>()
  for (const n of nodes) nodeMap.set(n.id, n)
  const sizeOf = (n: ModelNode) => nodeSizes?.get(n.id) ?? estimateNodePx(n.label)

  // Per-endpoint info for grouping by (node, edge)
  interface EpInfo {
    connKey: string
    isFrom: boolean
    otherCenter: { x: number; y: number }
  }

  const groups = new Map<string, EpInfo[]>()          // key = "nodeId|edge"
  const result: Record<string, Anchor> = {}

  // --- Pass 1: determine which edge each endpoint hits ---
  for (const c of connections) {
    const fNode = nodeMap.get(c.from)
    const tNode = nodeMap.get(c.to)
    if (!fNode || !tNode) continue

    const fp = posOf(fNode)
    const tp = posOf(tNode)
    const key = `${c.from}->${c.to}`

    // Direction in pixels (for aspect-correct edge selection)
    const dxPx = (tp.x - fp.x) * vpW / 100
    const dyPx = (tp.y - fp.y) * vpH / 100

    const fPx = sizeOf(fNode)
    const tPx = sizeOf(tNode)

    const fEdge = dominantEdge(fPx.w / 2, fPx.h / 2, dxPx, dyPx)
    const tEdge = dominantEdge(tPx.w / 2, tPx.h / 2, -dxPx, -dyPx)

    // Temporarily store center-to-center (overwritten in pass 2)
    result[key] = { fx: fp.x, fy: fp.y, tx: tp.x, ty: tp.y }

    const fgk = `${c.from}|${fEdge}`
    const tgk = `${c.to}|${tEdge}`
    let fg = groups.get(fgk); if (!fg) { fg = []; groups.set(fgk, fg) }
    let tg = groups.get(tgk); if (!tg) { tg = []; groups.set(tgk, tg) }
    fg.push({ connKey: key, isFrom: true, otherCenter: tp })
    tg.push({ connKey: key, isFrom: false, otherCenter: fp })
  }

  // --- Pass 2: distribute connections along each edge ---
  for (const [gk, eps] of groups) {
    const sepIdx = gk.indexOf('|')
    const nodeId = gk.slice(0, sepIdx)
    const edge = gk.slice(sepIdx + 1) as Edge
    const node = nodeMap.get(nodeId)!
    const np = posOf(node)
    const px = sizeOf(node)
    const hw = px.w / 2 / vpW * 100   // half-width in %
    const hh = px.h / 2 / vpH * 100   // half-height in %

    const horiz = edge === 'top' || edge === 'bottom'

    // Initial sort by tangent projection (a reasonable starting order)
    const tangentX = horiz ? 1 : 0
    const tangentY = horiz ? 0 : 1
    eps.sort((a, b) => {
      const adx = (a.otherCenter.x - np.x) * vpW / 100
      const ady = (a.otherCenter.y - np.y) * vpH / 100
      const bdx = (b.otherCenter.x - np.x) * vpW / 100
      const bdy = (b.otherCenter.y - np.y) * vpH / 100
      return (adx * tangentX + ady * tangentY) - (bdx * tangentX + bdy * tangentY)
    })

    // Assign slot positions — return primitives to avoid allocating { x, y } objects
    const n = eps.length
    const edgeFixedX = edge === 'left' ? np.x - hw : np.x + hw
    const edgeFixedY = edge === 'top' ? np.y - hh : np.y + hh
    function slotX(idx: number): number {
      const t = (idx + 1) / (n + 1)
      return horiz ? np.x - hw + t * 2 * hw : edgeFixedX
    }
    function slotY(idx: number): number {
      const t = (idx + 1) / (n + 1)
      return horiz ? edgeFixedY : np.y - hh + t * 2 * hh
    }

    // Bubble-sort pass: swap adjacent slots when their connection lines cross.
    // Uses the actual "from" endpoints to determine if the assigned lines intersect.
    let swapped = true
    let maxPasses = n * n + 10 // safety guard against infinite loops
    while (swapped && maxPasses-- > 0) {
      swapped = false
      for (let i = 0; i < n - 1; i++) {
        const pA = eps[i].otherCenter, pB = eps[i + 1].otherCenter
        if (segmentsIntersect(slotX(i), slotY(i), pA.x, pA.y, slotX(i + 1), slotY(i + 1), pB.x, pB.y)) {
          const tmp = eps[i]
          eps[i] = eps[i + 1]
          eps[i + 1] = tmp
          swapped = true
        }
      }
    }

    // Write final anchor positions (projected onto actual shape boundary)
    const nodeShape = node.shape
    const nodeCosmeticType = node.cosmeticType
    const needShapeAdjust = !!(nodeCosmeticType || (nodeShape && nodeShape !== 'rectangle' && nodeShape !== 'rounded-rect'))
    for (let i = 0; i < n; i++) {
      let spx = slotX(i), spy = slotY(i)
      const ep = eps[i]
      const a = result[ep.connKey]
      if (!a) continue

      // Adjust anchor to sit on shape boundary instead of bounding rect
      if (needShapeAdjust) {
        const dirX = spx - np.x
        const dirY = spy - np.y
        if (Math.abs(dirX) > 1e-9 || Math.abs(dirY) > 1e-9) {
          const pt = shapeEdgeIntersect(nodeShape, hw, hh, dirX, dirY, nodeCosmeticType)
          spx = np.x + pt.x
          spy = np.y + pt.y
        }
      }

      if (ep.isFrom) { a.fx = spx; a.fy = spy }
      else            { a.tx = spx; a.ty = spy }
    }
  }

  return result
}
