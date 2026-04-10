import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CAMERA_SCALE_FINAL } from './hybridZoom'
import { type Model, type ModelConnection, type ModelNode, type NodeShape } from './sampleModels'
import { UnzipPopup } from './UnzipPopup'
import { DEFAULT_GRID_SNAP, snapToGrid, useHybridZoomStore, type UnzipPopupState } from './useHybridZoomStore'
import { MpdDial } from './MpdDial'
import { LeftSidebar } from './LeftSidebar'
import { RightSidebar } from './RightSidebar'
import { loadModel, loadModelById, exportAllModels, registerModelUrl, clearLoaderCache } from './modelLoader'

/** Drives unzip open/close animation (0→1 open, 1→0 close) */
function useUnzipAnim(popupKey: string | null) {
  const [progress, setProgress] = useState(0)
  const currentRef = useRef(0)
  const lastKeyRef = useRef<string | null>(null)

  if (popupKey) lastKeyRef.current = popupKey

  useEffect(() => {
    if (popupKey) {
      currentRef.current = 0
      setProgress(0)
      const startTime = performance.now()
      let rafId: number
      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 400, 1)
        const eased = 1 - (1 - t) ** 3
        currentRef.current = eased
        setProgress(eased)
        if (t < 1) rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    } else {
      const from = currentRef.current
      if (from < 0.001) return
      const startTime = performance.now()
      let rafId: number
      const tick = () => {
        const elapsed = performance.now() - startTime
        const t = Math.min(elapsed / 250, 1)
        const eased = 1 - (1 - t) ** 3
        const v = from * (1 - eased)
        currentRef.current = v
        setProgress(v)
        if (t < 1) {
          rafId = requestAnimationFrame(tick)
        } else {
          lastKeyRef.current = null
          currentRef.current = 0
          setProgress(0)
        }
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    }
  }, [popupKey])

  const displayKey = (popupKey || progress > 0.001) ? (popupKey ?? lastKeyRef.current) : null
  return { progress, displayKey }
}

/** Minimum base dimensions fallback before label measured */
const NODE_MIN_W = 80
const NODE_MIN_H = 40

/* ---- Edge-anchored connection helpers ---- */

type Edge = 'top' | 'right' | 'bottom' | 'left'

/** Estimate the pixel size of a child-scene-node from its label.
 *  CSS: padding 10px 16px, border 2px, font ~0.95rem 600 */
function estimateNodePx(label: string): { w: number; h: number } {
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
function dominantEdge(
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
function shapeEdgeIntersect(
  shape: string | undefined,
  hw: number, hh: number,
  dx: number, dy: number,
): { x: number; y: number } {
  const s = shape ?? 'rounded-rect'

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
function shapeSvgPoints(shape: string, w: number, h: number): string {
  switch (shape) {
    case 'diamond': return `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`
    case 'hexagon': return `${w * 0.25},0 ${w * 0.75},0 ${w},${h / 2} ${w * 0.75},${h} ${w * 0.25},${h} 0,${h / 2}`
    case 'parallelogram': return `${w * 0.15},0 ${w},0 ${w * 0.85},${h} 0,${h}`
    case 'triangle': return `${w / 2},0 ${w},${h} 0,${h}`
    default: return ''
  }
}

interface Anchor { fx: number; fy: number; tx: number; ty: number }

/** Compute edge-anchored endpoints for every connection.
 *  Returns a map from connectionKey to { fx, fy, tx, ty } in percentage coords. */
function computeEdgeAnchors(
  nodes: ModelNode[],
  connections: ModelConnection[],
  vpW: number, vpH: number,
  posOf: (n: ModelNode) => { x: number; y: number },
  nodeSizes?: Map<string, { w: number; h: number }>,
): Record<string, Anchor> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
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

    // Assign slot positions
    const n = eps.length
    function slotPos(idx: number): { x: number; y: number } {
      const t = (idx + 1) / (n + 1)
      if (horiz) {
        return { x: np.x - hw + t * 2 * hw, y: edge === 'top' ? np.y - hh : np.y + hh }
      } else {
        return { x: edge === 'left' ? np.x - hw : np.x + hw, y: np.y - hh + t * 2 * hh }
      }
    }

    // Bubble-sort pass: swap adjacent slots when their connection lines cross.
    // Uses the actual "from" endpoints to determine if the assigned lines intersect.
    let swapped = true
    let maxPasses = n * n + 10 // safety guard against infinite loops
    while (swapped && maxPasses-- > 0) {
      swapped = false
      for (let i = 0; i < n - 1; i++) {
        const sA = slotPos(i), sB = slotPos(i + 1)
        const pA = eps[i].otherCenter, pB = eps[i + 1].otherCenter
        if (segmentsIntersect(sA.x, sA.y, pA.x, pA.y, sB.x, sB.y, pB.x, pB.y)) {
          const tmp = eps[i]
          eps[i] = eps[i + 1]
          eps[i + 1] = tmp
          swapped = true
        }
      }
    }

    // Write final anchor positions (projected onto actual shape boundary)
    for (let i = 0; i < n; i++) {
      let sp = slotPos(i)
      const ep = eps[i]
      const a = result[ep.connKey]
      if (!a) continue

      // Adjust anchor to sit on shape boundary instead of bounding rect
      const nodeShape = node.shape
      if (nodeShape && nodeShape !== 'rectangle' && nodeShape !== 'rounded-rect') {
        const dirX = sp.x - np.x
        const dirY = sp.y - np.y
        if (Math.abs(dirX) > 1e-9 || Math.abs(dirY) > 1e-9) {
          const pt = shapeEdgeIntersect(nodeShape, hw, hh, dirX, dirY)
          sp = { x: np.x + pt.x, y: np.y + pt.y }
        }
      }

      if (ep.isFrom) { a.fx = sp.x; a.fy = sp.y }
      else            { a.tx = sp.x; a.ty = sp.y }
    }
  }

  return result
}

/* ---- Auto-untangle helpers ---- */

/** Standard 2D cross product of vectors (b-a) × (c-a) */
function cross2d(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

/** Do the open segments (a→b) and (c→d) properly intersect? (ignores shared endpoints & collinear) */
function segmentsIntersect(
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
function countCrossings(
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
function segmentIntersectsRect(
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

/**
 * Compute untangled target positions.
 * Phase 1: targeted endpoint displacement — for each crossing, try nudging
 *          each of the 4 involved endpoints across the opposing edge.
 * Phase 2: greedy node-pair swaps as fallback for crossings Phase 1 can't resolve.
 * Phase 3: force refinement to clean up spacing.
 * Returns a map from nodeId to {x, y} in percentage coords, or null if already untangled.
 */
function computeUntangledPositions(
  nodes: ModelNode[],
  connections: ModelConnection[],
  vpW: number,
  vpH: number,
  gridSnapSize = DEFAULT_GRID_SNAP,
): Record<string, { x: number; y: number }> | null {
  // Work in pixel space for aspect-correct geometry
  const pos = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    pos.set(n.id, { x: n.x * vpW / 100, y: n.y * vpH / 100 })
  }

  const posOf = (id: string) => pos.get(id)!
  const MARGIN_PX = 15
  const BOUNDARY = 4
  const minX = BOUNDARY * vpW / 100, maxX = (100 - BOUNDARY) * vpW / 100
  const minY = BOUNDARY * vpH / 100, maxY = (100 - BOUNDARY) * vpH / 100

  function clampedPos(x: number, y: number) {
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    }
  }

  function totalCrossings(): number {
    return countCrossings(nodes, connections, posOf)
  }

  function findCrossingPairs(): [number, number][] {
    const result: [number, number][] = []
    for (let i = 0; i < connections.length; i++) {
      const c1 = connections[i]
      const a = posOf(c1.from), b = posOf(c1.to)
      for (let j = i + 1; j < connections.length; j++) {
        const c2 = connections[j]
        if (c1.from === c2.from || c1.from === c2.to ||
            c1.to === c2.from || c1.to === c2.to) continue
        const c = posOf(c2.from), d = posOf(c2.to)
        if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y))
          result.push([i, j])
      }
    }
    return result
  }

  // Count connections passing through non-endpoint nodes
  function countNodeOverlaps(): number {
    let count = 0
    for (const c of connections) {
      const a = posOf(c.from), b = posOf(c.to)
      for (const n of nodes) {
        if (n.id === c.from || n.id === c.to) continue
        const np = posOf(n.id)
        const px = estimateNodePx(n.label)
        if (segmentIntersectsRect(a.x, a.y, b.x, b.y, np.x, np.y, px.w / 2, px.h / 2)) count++
      }
    }
    return count
  }

  const initialCrossings = totalCrossings()
  const initialOverlaps = countNodeOverlaps()
  if (initialCrossings === 0 && initialOverlaps === 0) return null

  // --- Phase 1: Targeted endpoint displacement ---
  // For each crossing (A→B) × (C→D), try moving each of the 4 endpoints
  // perpendicular to the opposing edge so it lands on its partner's side.
  for (let round = 0; round < 80; round++) {
    const crossings = findCrossingPairs()
    if (crossings.length === 0) break
    const curCount = crossings.length

    let bestId = '', bestX = 0, bestY = 0, bestReduction = 0

    for (const [ci, cj] of crossings) {
      const c1 = connections[ci], c2 = connections[cj]
      // 4 candidate moves: nudge each endpoint across the opposing edge
      const candidates = [
        { id: c1.from, partnerId: c1.to, lineFrom: c2.from, lineTo: c2.to },
        { id: c1.to, partnerId: c1.from, lineFrom: c2.from, lineTo: c2.to },
        { id: c2.from, partnerId: c2.to, lineFrom: c1.from, lineTo: c1.to },
        { id: c2.to, partnerId: c2.from, lineFrom: c1.from, lineTo: c1.to },
      ]

      for (const cand of candidates) {
        const p = posOf(cand.id)
        const partner = posOf(cand.partnerId)
        const lf = posOf(cand.lineFrom), lt = posOf(cand.lineTo)

        // Normal to the opposing edge
        const ldx = lt.x - lf.x, ldy = lt.y - lf.y
        const len = Math.sqrt(ldx * ldx + ldy * ldy)
        if (len < 0.01) continue
        const nx = -ldy / len, ny = ldx / len

        // Signed distances from the opposing edge's line
        const distP = (p.x - lf.x) * nx + (p.y - lf.y) * ny
        const distPartner = (partner.x - lf.x) * nx + (partner.y - lf.y) * ny

        // Move P to partner's side (they're currently on opposite sides)
        const targetDist = Math.sign(distPartner) * MARGIN_PX
        const displacement = targetDist - distP
        const newPos = clampedPos(p.x + nx * displacement, p.y + ny * displacement)

        // Tentatively apply
        const origX = p.x, origY = p.y
        p.x = newPos.x; p.y = newPos.y

        const newCount = findCrossingPairs().length
        const reduction = curCount - newCount

        // Restore
        p.x = origX; p.y = origY

        if (reduction > bestReduction) {
          bestReduction = reduction
          bestId = cand.id
          bestX = newPos.x; bestY = newPos.y
        }
      }
    }

    if (bestReduction <= 0) break
    const p = posOf(bestId)
    p.x = bestX; p.y = bestY
  }

  // --- Phase 2: Greedy swaps as fallback ---
  for (let round = 0; round < 50; round++) {
    const curCrossings = totalCrossings()
    if (curCrossings === 0) break

    let bestI = -1, bestJ = -1, bestReduction = 0
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pi = posOf(nodes[i].id), pj = posOf(nodes[j].id)
        const tmpX = pi.x, tmpY = pi.y
        pi.x = pj.x; pi.y = pj.y; pj.x = tmpX; pj.y = tmpY

        const newCrossings = totalCrossings()
        const reduction = curCrossings - newCrossings

        pj.x = pi.x; pj.y = pi.y; pi.x = tmpX; pi.y = tmpY

        if (reduction > bestReduction) {
          bestReduction = reduction; bestI = i; bestJ = j
        }
      }
    }

    if (bestReduction <= 0) break
    const pi = posOf(nodes[bestI].id), pj = posOf(nodes[bestJ].id)
    const tmpX = pi.x, tmpY = pi.y
    pi.x = pj.x; pi.y = pj.y; pj.x = tmpX; pj.y = tmpY
  }

  // --- Phase 3: Force refinement for spacing ---
  const ITERS = 120
  const anchor = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const p = posOf(n.id)
    anchor.set(n.id, { x: p.x, y: p.y })
  }

  // Pre-compute node pixel sizes for overlap-aware forces
  const nodeSizes = new Map<string, { hw: number; hh: number }>()
  for (const n of nodes) {
    const px = estimateNodePx(n.label)
    nodeSizes.set(n.id, { hw: px.w / 2, hh: px.h / 2 })
  }

  for (let iter = 0; iter < ITERS; iter++) {
    const t = 1 - iter / ITERS
    const step = 6.0 * t

    const forces = new Map<string, { fx: number; fy: number }>()
    for (const n of nodes) forces.set(n.id, { fx: 0, fy: 0 })

    // Node-node repulsion: use actual bounding box overlap instead of fixed distance
    for (let i = 0; i < nodes.length; i++) {
      const pi = posOf(nodes[i].id)
      const si = nodeSizes.get(nodes[i].id)!
      for (let j = i + 1; j < nodes.length; j++) {
        const pj = posOf(nodes[j].id)
        const sj = nodeSizes.get(nodes[j].id)!

        // Required separation: sum of half-dims + padding
        const reqX = si.hw + sj.hw + 20
        const reqY = si.hh + sj.hh + 12

        const dx = pi.x - pj.x, dy = pi.y - pj.y
        const overlapX = reqX - Math.abs(dx)
        const overlapY = reqY - Math.abs(dy)

        if (overlapX > 0 && overlapY > 0) {
          // Boxes overlap — push apart along the axis with less overlap
          const fi = forces.get(nodes[i].id)!, fj = forces.get(nodes[j].id)!
          if (overlapX < overlapY) {
            const push = overlapX * 0.4 * (dx >= 0 ? 1 : -1)
            fi.fx += push; fj.fx -= push
          } else {
            const push = overlapY * 0.4 * (dy >= 0 ? 1 : -1)
            fi.fy += push; fj.fy -= push
          }
        } else {
          // No box overlap but maybe too close center-to-center
          const d2 = dx * dx + dy * dy
          const minDist = 70
          if (d2 < minDist * minDist && d2 > 0.01) {
            const d = Math.sqrt(d2)
            const f = (minDist - d) * 0.3
            const ux = dx / d, uy = dy / d
            const fi = forces.get(nodes[i].id)!, fj = forces.get(nodes[j].id)!
            fi.fx += ux * f; fi.fy += uy * f
            fj.fx -= ux * f; fj.fy -= uy * f
          }
        }
      }
    }

    // Node-connection overlap avoidance: push nodes away from connections that
    // pass through them (only for nodes that are not endpoints of that connection)
    for (const c of connections) {
      const a = posOf(c.from), b = posOf(c.to)
      for (const n of nodes) {
        if (n.id === c.from || n.id === c.to) continue
        const np = posOf(n.id)
        const ns = nodeSizes.get(n.id)!
        const pad = 10 // extra clearance around the node box
        if (!segmentIntersectsRect(a.x, a.y, b.x, b.y, np.x, np.y, ns.hw + pad, ns.hh + pad)) continue

        // Push this node perpendicular to the connection line
        const ldx = b.x - a.x, ldy = b.y - a.y
        const len2 = ldx * ldx + ldy * ldy
        if (len2 < 1) continue
        const len = Math.sqrt(len2)
        // Normal direction (pick the side the node center is already on)
        let nx = -ldy / len, ny = ldx / len
        const side = (np.x - a.x) * nx + (np.y - a.y) * ny
        if (side < 0) { nx = -nx; ny = -ny }

        const pushForce = 8.0
        const fn = forces.get(n.id)!
        fn.fx += nx * pushForce
        fn.fy += ny * pushForce
      }
    }

    // Pull toward post-untangle anchor
    for (const n of nodes) {
      const p = posOf(n.id)
      const a = anchor.get(n.id)!
      const f = forces.get(n.id)!
      f.fx += (a.x - p.x) * 0.05
      f.fy += (a.y - p.y) * 0.05
    }

    // Apply with step limit; reject moves that increase crossings
    const prevCrossings = totalCrossings()
    const saved = new Map<string, { x: number; y: number }>()
    for (const n of nodes) {
      const p = posOf(n.id)
      saved.set(n.id, { x: p.x, y: p.y })
    }

    for (const n of nodes) {
      const p = posOf(n.id)
      const f = forces.get(n.id)!
      let dx = f.fx, dy = f.fy
      const mag = Math.sqrt(dx * dx + dy * dy)
      if (mag > step) { dx = dx / mag * step; dy = dy / mag * step }
      p.x = Math.max(minX, Math.min(maxX, p.x + dx))
      p.y = Math.max(minY, Math.min(maxY, p.y + dy))
    }

    if (totalCrossings() > prevCrossings) {
      for (const n of nodes) {
        const p = posOf(n.id)
        const s = saved.get(n.id)!
        p.x = s.x; p.y = s.y
      }
    }
  }

  // Convert back to percentage and snap to grid
  const result: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const p = posOf(n.id)
    result[n.id] = {
      x: snapToGrid(p.x * 100 / vpW, gridSnapSize),
      y: snapToGrid(p.y * 100 / vpH, gridSnapSize),
    }
  }
  return result
}

export function PrototypeViewport() {
  const [debugOpen, setDebugOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 1400, h: 900 })
  const {
    stack,
    currentFrame,
    isDragging,
    isPaused,
    unzipPopup,
    selectNode,
    clearSelection,
    zoomIn,
    zoomOut,
    pushModel,
    openUnzip,
    closeUnzip,
    pause,
    beginDrag,
    endDrag,
    panBy,
    getModel: storeGetModel,
    moveNode,
    moveNodes,
    beginMoveNode,
    beginEditNode,
    addNode,
    updateNodeLabel,
    updateNodeShape,
    updateNodeProps,
    setNodeLabelSilent,
    removeNode,
    addConnection,
    undo,
    redo,
    undoStacks,
    redoStacks,
    switchFrameMpd,
    switchNodeMpd,
    clearLastChildModelId,
    setLastChildModelId,
    registerModel,
    updateModelLabel,
    resetToRoot,
    models: storeModels,
    gridSnap,
    setGridSnap,
    updateConnectionEvidence,
  } = useHybridZoomStore()

  const frame = currentFrame()
  const model = storeGetModel(frame.modelId)!
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      setVpSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Load root model from JSON on startup (if not already in store from hardcoded data)
  useEffect(() => {
    if (!storeGetModel('root')) {
      setIsLoading(true)
      loadModel('/models/root.json', registerModel).finally(() => setIsLoading(false))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load child models when a node is selected that has a childModelId not yet in store
  const selectedNode = model?.nodes.find((n) => n.id === frame.selectedNodeId)
  useEffect(() => {
    if (selectedNode?.childModelId && !storeGetModel(selectedNode.childModelId)) {
      loadModelById(selectedNode.childModelId, registerModel)
    }
    // Also pre-load MPD siblings
    if (selectedNode?.mpdIds) {
      for (const id of selectedNode.mpdIds) {
        if (!storeGetModel(id)) loadModelById(id, registerModel)
      }
    }
  }, [selectedNode?.childModelId, selectedNode?.mpdIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unzip open/close animation
  const { progress: unzipAnimProgress, displayKey: unzipDisplayKey } = useUnzipAnim(
    unzipPopup?.connectionKey ?? null,
  )
  const lastUnzipRef = useRef<UnzipPopupState | null>(null)
  if (unzipPopup) lastUnzipRef.current = unzipPopup
  const activeUnzipPopup = unzipDisplayKey ? (unzipPopup ?? lastUnzipRef.current) : null

  // Track popup measured size for ConnectionLine bow computation
  const [popupSize, setPopupSize] = useState<{ w: number; h: number } | null>(null)
  const handlePopupSizeChange = useMemo(() => (w: number, h: number) => setPopupSize({ w, h }), [])

  const p = frame.snapshot.nodeInflation // 0→1
  const isChild = frame.snapshot.handoffMode === 'child'

  // Find the selected node's child model (prefer lastChildModelId to preserve MPD switch)
  const childModelId = frame.lastChildModelId ?? selectedNode?.childModelId
  const childModel = childModelId ? storeGetModel(childModelId) : undefined

  // MPD dial — two modes:
  // 1. Node-level: selected node at any depth has childModelId + mpdIds (> 1
  //    combined perspective).  The dial picks which perspective to zoom into
  //    by setting lastChildModelId (transient frame state, NOT node data).
  // 2. Frame-level: after zooming in, the frame has multiple perspectives.
  //    The dial switches the whole view via switchFrameMpd + curtain.

  // --- Node-level dial ---
  // Only mpdIds — RMM (childModelId) is separate and never appears on the MPD dial
  // When we've switched to an MPD model (nodeMpdOriginalModelId is set), look up
  // the source node from the original model so the dial stays visible.
  const nodeMpdSourceNode = useMemo(() => {
    if (!frame.nodeMpdOriginalModelId || !frame.selectedNodeId) return null
    const origModel = storeModels[frame.nodeMpdOriginalModelId]
    return origModel?.nodes.find((n) => n.id === frame.selectedNodeId) ?? null
  }, [frame.nodeMpdOriginalModelId, frame.selectedNodeId, storeModels])

  const nodeDialIds = useMemo(() => {
    const node = nodeMpdSourceNode ?? selectedNode
    if (!node) return null
    if (!node.mpdIds || node.mpdIds.length < 2) return null
    return node.mpdIds
  }, [nodeMpdSourceNode, selectedNode])

  // --- Frame-level dial ---
  // Derive live MPD perspectives from the entry node in the parent model
  // so newly added MPDs are picked up without re-zooming.
  // Only mpdIds — childModelId (RMM) is never part of the frame-level dial.
  const liveMpdIds = useMemo(() => {
    if (stack.length < 2 || !frame.entryNodeId) return undefined
    const parentFrame = stack[stack.length - 2]
    const parentModel = storeModels[parentFrame.modelId]
    const entryNode = parentModel?.nodes.find((n) => n.id === frame.entryNodeId)
    if (!entryNode?.mpdIds || entryNode.mpdIds.length < 2) return undefined
    return entryNode.mpdIds
  }, [stack, frame.entryNodeId, storeModels])

  // Node-level takes priority; frame-level only when no node-level and a node is selected
  const isNodeLevelMpd = !!nodeDialIds
  const isFrameLevelMpd = !isNodeLevelMpd && !!liveMpdIds && liveMpdIds.length > 1 && !!frame.selectedNodeId

  const mpdOptions = useMemo(() => {
    if (isNodeLevelMpd) {
      return nodeDialIds!.map((id) => {
        const m = storeGetModel(id)
        return { id, label: m?.label ?? id }
      })
    }
    if (isFrameLevelMpd) {
      return liveMpdIds!.map((id) => {
        const m = storeGetModel(id)
        return { id, label: m?.label ?? id }
      })
    }
    return null
  }, [isNodeLevelMpd, isFrameLevelMpd, nodeDialIds, liveMpdIds, storeGetModel])

  const mpdActiveIndex = useMemo(() => {
    if (!mpdOptions) return 0
    if (isNodeLevelMpd) {
      // When viewing the original model (or no MPD switch yet), active = first entry (default)
      if (!frame.nodeMpdOriginalModelId) return 0
      // Otherwise find which mpdId matches current frame.modelId
      const idx = nodeDialIds!.indexOf(frame.modelId)
      return idx >= 0 ? idx : 0
    }
    return Math.max(0, liveMpdIds!.indexOf(frame.modelId))
  }, [mpdOptions, isNodeLevelMpd, frame.modelId, frame.nodeMpdOriginalModelId, nodeDialIds, liveMpdIds])

  const sceneStyle = useMemo(() => {
    // Auto-center: smoothly pan the scene so the selected node tracks toward viewport center.
    // At nodeProgress=0, no centering. At nodeProgress=1, node is centered.
    // Formula: centering = nodeProgress × (0.5 − node.x/100) × vpSize × cameraScale
    let cx = 0
    let cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * frame.snapshot.cameraScale
      cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * frame.snapshot.cameraScale
    }
    const gridPxW = vpSize.w * gridSnap / 100
    const gridPxH = vpSize.h * gridSnap / 100
    return {
      transform: `translate(${cx + frame.panOffset.x}px, ${cy + frame.panOffset.y}px) scale(${frame.snapshot.cameraScale})`,
      backgroundSize: `${gridPxW}px ${gridPxH}px`,
    }
  }, [selectedNode, frame.snapshot.nodeProgress, frame.snapshot.cameraScale, frame.panOffset.x, frame.panOffset.y, vpSize.w, vpSize.h, gridSnap])

  // At handoff, push into child model (prefer lastChildModelId to preserve MPD switch)
  useEffect(() => {
    if (isChild && selectedNode?.childModelId) {
      pushModel(frame.lastChildModelId ?? selectedNode.childModelId, selectedNode.id)
    }
  }, [isChild, selectedNode?.childModelId, selectedNode?.id, frame.lastChildModelId, pushModel])

  // Compute the centering offset currently applied for the selected node
  // so we can bake it into panOffset when switching nodes (prevents visual jump)
  const handleSelectNode = (nodeId: string) => {
    if (selectedNode && frame.snapshot.nodeProgress > 0) {
      const np = frame.snapshot.nodeProgress
      const cs = frame.snapshot.cameraScale
      const residual = {
        x: np * (0.5 - selectedNode.x / 100) * vpSize.w * cs,
        y: np * (0.5 - selectedNode.y / 100) * vpSize.h * cs,
      }
      selectNode(nodeId, residual)
    } else {
      selectNode(nodeId)
    }
  }

  // ---- Node dragging ----
  const draggingNodeRef = useRef<string | null>(null)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const multiDragOffsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map())

  // ---- Selection rectangle mode ----
  const [selectMode, setSelectMode] = useState(false)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [selectionRect, setSelectionRect] = useState<{
    startX: number; startY: number; endX: number; endY: number
  } | null>(null)
  const selectionStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const justFinishedSelectionRef = useRef(false)
  const clipboardRef = useRef<{ nodes: ModelNode[]; connections: ModelConnection[] } | null>(null)

  // Clear multi-selection when model changes (e.g. MPD switch)
  useEffect(() => { setSelectedNodeIds(new Set()) }, [frame.modelId])

  // MPD curtain transition state
  const [mpdCurtain, setMpdCurtain] = useState<{
    oldModel: Model
    oldSceneStyle: React.CSSProperties
    progress: number
    direction: 'left' | 'right'
  } | null>(null)
  const curtainRaf = useRef<number>(0)

  /** Convert a client (screen) position to scene-percentage coords */
  const clientToScene = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current
    if (!el) return { x: 50, y: 50 }
    const rect = el.getBoundingClientRect()
    // Account for scene transform: translate + scale
    const cs = frame.snapshot.cameraScale
    let cx = 0, cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * cs
      cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * cs
    }
    const ox = frame.panOffset.x + cx
    const oy = frame.panOffset.y + cy
    // Scene local pixel coords
    const localX = (clientX - rect.left - rect.width / 2 - ox) / cs + rect.width / 2
    const localY = (clientY - rect.top - rect.height / 2 - oy) / cs + rect.height / 2
    return {
      x: (localX / rect.width) * 100,
      y: (localY / rect.height) * 100,
    }
  }, [frame.snapshot.cameraScale, frame.snapshot.nodeProgress, frame.panOffset.x, frame.panOffset.y, selectedNode, vpSize.w, vpSize.h])

  const handleNodeDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    draggingNodeRef.current = nodeId
    setDraggingNodeId(nodeId)
    beginMoveNode(frame.modelId)
    // Capture offsets for multi-drag when dragged node is in the selection
    multiDragOffsetsRef.current.clear()
    if (selectedNodeIds.has(nodeId)) {
      const pos = clientToScene(e.clientX, e.clientY)
      for (const id of selectedNodeIds) {
        const n = model.nodes.find((nd) => nd.id === id)
        if (n && id !== nodeId) {
          multiDragOffsetsRef.current.set(id, { dx: n.x - pos.x, dy: n.y - pos.y })
        }
      }
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [beginMoveNode, frame.modelId, selectedNodeIds, clientToScene, model.nodes])

  const handleNodeDragMove = useCallback((e: React.PointerEvent) => {
    if (!draggingNodeRef.current) return
    const pos = clientToScene(e.clientX, e.clientY)
    if (multiDragOffsetsRef.current.size > 0) {
      // Multi-drag: move primary node + all offset companions
      const moves = [{ nodeId: draggingNodeRef.current, x: pos.x, y: pos.y }]
      for (const [id, off] of multiDragOffsetsRef.current) {
        moves.push({ nodeId: id, x: pos.x + off.dx, y: pos.y + off.dy })
      }
      moveNodes(frame.modelId, moves)
    } else {
      moveNode(frame.modelId, draggingNodeRef.current, pos.x, pos.y)
    }
  }, [clientToScene, frame.modelId, moveNode, moveNodes])

  const handleNodeDragEnd = useCallback(() => {
    draggingNodeRef.current = null
    multiDragOffsetsRef.current.clear()
    setDraggingNodeId(null)
  }, [])

  // ---- Connection creation (right-click drag) ----
  const [connectionDraft, setConnectionDraft] = useState<{
    fromId: string
    fromX: number
    fromY: number
    toX: number
    toY: number
  } | null>(null)

  const handleConnectionDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const node = model.nodes.find((n) => n.id === nodeId)
    if (!node) return
    setConnectionDraft({
      fromId: nodeId,
      fromX: node.x,
      fromY: node.y,
      toX: node.x,
      toY: node.y,
    })
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [model.nodes])

  const handleConnectionDragMove = useCallback((e: React.PointerEvent) => {
    if (!connectionDraft) return
    const pos = clientToScene(e.clientX, e.clientY)
    setConnectionDraft((d) => d ? { ...d, toX: pos.x, toY: pos.y } : null)
  }, [connectionDraft, clientToScene])

  const handleConnectionDragEnd = useCallback((e: React.PointerEvent) => {
    if (!connectionDraft) return
    // Find if pointer is over a target node
    const pos = clientToScene(e.clientX, e.clientY)
    const target = model.nodes.find((n) => {
      const dx = n.x - pos.x
      const dy = n.y - pos.y
      return Math.sqrt(dx * dx + dy * dy) < 5 // hit radius ~5% of scene
    })
    if (target && target.id !== connectionDraft.fromId) {
      addConnection(frame.modelId, { from: connectionDraft.fromId, to: target.id })
    }
    setConnectionDraft(null)
  }, [connectionDraft, clientToScene, model.nodes, frame.modelId, addConnection])

  // ---- Node creation (double-click on empty space) ----
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // Only on empty space (the viewport itself)
    if (e.target !== e.currentTarget) return
    const pos = clientToScene(e.clientX, e.clientY)
    const snappedX = snapToGrid(pos.x)
    const snappedY = snapToGrid(pos.y)
    const newId = `node-${Date.now()}`
    addNode(frame.modelId, { id: newId, label: '', x: snappedX, y: snappedY })
    selectNode(newId)
    setEditingNodeId(newId)
  }, [clientToScene, frame.modelId, addNode, selectNode])

  // ---- Drop from sidebar (shape palette) ----
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/unigram-shape')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    const shapeId = e.dataTransfer.getData('application/unigram-shape')
    if (!shapeId) return
    e.preventDefault()
    // Clear any pan state that may have started from pointer events during the drag
    endDrag()
    lastPointer.current = null
    const pos = clientToScene(e.clientX, e.clientY)
    const snappedX = snapToGrid(pos.x)
    const snappedY = snapToGrid(pos.y)
    const newId = `node-${Date.now()}`
    addNode(frame.modelId, {
      id: newId,
      label: '',
      x: snappedX,
      y: snappedY,
      shape: shapeId as NodeShape,
    })
    selectNode(newId)
    setEditingNodeId(newId)
  }, [clientToScene, frame.modelId, addNode, selectNode, endDrag])

  // ---- Node deletion (Delete key) + Undo/Redo + Copy/Paste ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo(frame.modelId)
        return
      }
      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault()
        redo(frame.modelId)
        return
      }
      // Copy: Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (editingNodeId) return // don't intercept text copy in edit mode
        const ids = selectedNodeIds.size > 0
          ? selectedNodeIds
          : frame.selectedNodeId ? new Set([frame.selectedNodeId]) : null
        if (!ids || ids.size === 0) return
        e.preventDefault()
        const nodes = model.nodes.filter((n) => ids.has(n.id))
        const connections = model.connections.filter(
          (c) => ids.has(c.from) && ids.has(c.to),
        )
        clipboardRef.current = { nodes, connections }
        return
      }
      // Paste: Ctrl+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (editingNodeId) return
        const clip = clipboardRef.current
        if (!clip || clip.nodes.length === 0) return
        e.preventDefault()
        const idMap = new Map<string, string>()
        const pastedIds = new Set<string>()
        // Create new IDs and offset positions
        for (const node of clip.nodes) {
          const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          idMap.set(node.id, newId)
          pastedIds.add(newId)
        }
        beginEditNode(frame.modelId) // push undo snapshot
        for (const node of clip.nodes) {
          const newId = idMap.get(node.id)!
          addNode(frame.modelId, {
            ...node,
            id: newId,
            x: snapToGrid(node.x + 4),
            y: snapToGrid(node.y + 4),
            // Don't copy RMM/MPD references — those are specific to the source node
            childModelId: undefined,
            mpdIds: undefined,
          })
        }
        for (const conn of clip.connections) {
          const newFrom = idMap.get(conn.from)
          const newTo = idMap.get(conn.to)
          if (newFrom && newTo) {
            addConnection(frame.modelId, { from: newFrom, to: newTo })
          }
        }
        // Select the pasted nodes
        setSelectedNodeIds(pastedIds)
        clearSelection() // clear single-select
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete while typing in a node label
        if (editingNodeId) return
        // Multi-selection delete
        if (selectedNodeIds.size > 0) {
          beginEditNode(frame.modelId) // push undo snapshot
          for (const id of selectedNodeIds) {
            removeNode(frame.modelId, id)
          }
          setSelectedNodeIds(new Set())
          return
        }
        if (frame.selectedNodeId) {
          removeNode(frame.modelId, frame.selectedNodeId)
        }
      }
      // Escape to deselect or cancel editing
      if (e.key === 'Escape') {
        if (editingNodeId) {
          // If label is still empty, remove the node
          const node = model.nodes.find((n) => n.id === editingNodeId)
          if (node && !node.label.trim()) {
            removeNode(frame.modelId, editingNodeId)
          }
          setEditingNodeId(null)
        } else {
          clearSelection()
          setSelectedNodeIds(new Set())
          closeUnzip()
        }
      }
      // Select All: Ctrl+A
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (editingNodeId) return
        e.preventDefault()
        setSelectedNodeIds(new Set(model.nodes.map((n) => n.id)))
        return
      }
      // Tab or F2 to start editing the selected node
      if ((e.key === 'Tab' || e.key === 'F2') && !editingNodeId && frame.selectedNodeId) {
        e.preventDefault()
        beginEditNode(frame.modelId)
        setEditingNodeId(frame.selectedNodeId)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [frame.selectedNodeId, frame.modelId, editingNodeId, model.nodes, model.connections, selectedNodeIds, removeNode, clearSelection, closeUnzip, undo, redo, beginEditNode, addNode, addConnection])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = useCallback(() => {
    const files = exportAllModels(storeModels)
    const blob = new Blob([JSON.stringify(files, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'unigram-project.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [storeModels])

  const handleLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        // data is Record<filename, ModelFile> — we need to import them
        clearLoaderCache()
        const basePath = '/models/'
        for (const [filename, fileData] of Object.entries(data)) {
          const modelFile = fileData as { id: string; label: string; nodes: unknown[]; connections: unknown[] }
          registerModelUrl(modelFile.id, basePath + filename)
        }
        // Second pass: resolve references and register models
        for (const [filename, fileData] of Object.entries(data)) {
          const mf = fileData as {
            id: string; label: string
            nodes: { id: string; label: string; x: number; y: number; childModel?: string; mpdModels?: string[] }[]
            connections: { from: string; to: string; evidence?: { title: string; citation: string; url: string }[] }[]
          }
          // Resolve file refs to model IDs
          const idLookup = new Map<string, string>()
          for (const [fn, fd] of Object.entries(data)) {
            const m = fd as { id: string }
            // Handle both relative and bare filename refs
            idLookup.set('./' + fn, m.id)
            idLookup.set(fn, m.id)
          }
          // Preserve childModelId/mpdIds from existing store when save file lacks them
          const existingModel = storeGetModel(mf.id)
          const existingNodeMap = new Map(existingModel?.nodes.map(n => [n.id, n]) ?? [])
          registerModel({
            id: mf.id,
            label: mf.label,
            nodes: mf.nodes.map((n) => {
              const existing = existingNodeMap.get(n.id)
              return {
                id: n.id, label: n.label, x: n.x, y: n.y,
                childModelId: n.childModel ? idLookup.get(n.childModel) : existing?.childModelId,
                mpdIds: n.mpdModels?.length
                  ? n.mpdModels.map((p) => idLookup.get(p)).filter(Boolean) as string[]
                  : existing?.mpdIds,
              }
            }),
            connections: mf.connections,
          })
        }
        // Reset zoom stack to root so stale frames don't reference old state
        resetToRoot()
      } catch (err) {
        console.error('Failed to load project file:', err)
      }
    }
    reader.readAsText(file)
    e.target.value = '' // reset so the same file can be re-loaded
  }, [registerModel, resetToRoot])

  // ---- Auto-untangle animation ----
  const [isUntangling, setIsUntangling] = useState(false)
  const untangleRaf = useRef<number>(0)

  const handleUntangle = useCallback(() => {
    if (isUntangling) return
    const targets = computeUntangledPositions(model.nodes, model.connections, vpSize.w, vpSize.h, gridSnap)
    if (!targets) return // already untangled

    beginMoveNode(frame.modelId) // snapshot for undo
    setIsUntangling(true)

    // Capture stable data for the animation closure
    const nodeIds = model.nodes.map(n => n.id)
    const starts: Record<string, { x: number; y: number }> = {}
    for (const n of model.nodes) starts[n.id] = { x: n.x, y: n.y }
    const modelId = frame.modelId

    const duration = 800 // ms
    const t0 = performance.now()

    const animate = (now: number) => {
      const elapsed = now - t0
      const raw = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const p = 1 - Math.pow(1 - raw, 3)

      const moves: { nodeId: string; x: number; y: number }[] = []
      for (const id of nodeIds) {
        const s = starts[id], e = targets[id]
        if (!s || !e) continue
        moves.push({
          nodeId: id,
          x: s.x + (e.x - s.x) * p,
          y: s.y + (e.y - s.y) * p,
        })
      }
      moveNodes(modelId, moves)

      if (raw < 1) {
        untangleRaf.current = requestAnimationFrame(animate)
      } else {
        setIsUntangling(false)
      }
    }
    untangleRaf.current = requestAnimationFrame(animate)
  }, [isUntangling, model, vpSize, frame.modelId, beginMoveNode, moveNodes])

  // Cleanup raf on unmount
  useEffect(() => () => cancelAnimationFrame(untangleRaf.current), [])

  return (
    <div
      ref={viewportRef}
      className={`viewport ${isDragging ? 'dragging' : ''}${selectMode ? ' select-mode' : ''}`}
      onWheel={(event) => {
        event.preventDefault()
        // Cancel any running untangle animation before zooming
        if (isUntangling) {
          cancelAnimationFrame(untangleRaf.current)
          setIsUntangling(false)
        }
        if (event.deltaY < 0) {
          zoomIn()
        } else {
          zoomOut()
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Selection-rectangle mode: start rubber band on empty space
        if (selectMode && !draggingNodeRef.current && !connectionDraft) {
          const el = event.target as HTMLElement
          if (!el.closest('.host-node')) {
            selectionStartRef.current = { clientX: event.clientX, clientY: event.clientY }
            const pos = clientToScene(event.clientX, event.clientY)
            setSelectionRect({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y })
            return
          }
        }
        beginDrag()
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerMove={(event) => {
        // Selection rectangle dragging
        if (selectionStartRef.current) {
          const pos = clientToScene(event.clientX, event.clientY)
          setSelectionRect((r) => r ? { ...r, endX: pos.x, endY: pos.y } : null)
          return
        }
        // Node dragging takes priority
        if (draggingNodeRef.current) {
          handleNodeDragMove(event)
          return
        }
        // Connection dragging
        if (connectionDraft) {
          handleConnectionDragMove(event)
          return
        }
        if (!isDragging || !lastPointer.current) return
        const dx = event.clientX - lastPointer.current.x
        const dy = event.clientY - lastPointer.current.y
        panBy(dx, dy)
        lastPointer.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        // Finish selection rectangle
        if (selectionStartRef.current && selectionRect) {
          selectionStartRef.current = null
          const minX = Math.min(selectionRect.startX, selectionRect.endX)
          const maxX = Math.max(selectionRect.startX, selectionRect.endX)
          const minY = Math.min(selectionRect.startY, selectionRect.endY)
          const maxY = Math.max(selectionRect.startY, selectionRect.endY)
          const ids = new Set<string>()
          for (const node of model.nodes) {
            if (node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
              ids.add(node.id)
            }
          }
          setSelectedNodeIds(ids)
          setSelectionRect(null)
          justFinishedSelectionRef.current = true
          return
        }
        if (draggingNodeRef.current) {
          handleNodeDragEnd()
          return
        }
        if (connectionDraft) {
          handleConnectionDragEnd(event)
          return
        }
        endDrag()
        lastPointer.current = null
        pause()
      }}
      onPointerLeave={() => {
        if (selectionStartRef.current) {
          selectionStartRef.current = null
          setSelectionRect(null)
        }
        handleNodeDragEnd()
        setConnectionDraft(null)
        endDrag()
        lastPointer.current = null
      }}
      onClick={(event) => {
        if (justFinishedSelectionRef.current) {
          justFinishedSelectionRef.current = false
          return
        }
        const el = event.target as HTMLElement
        if (el === event.currentTarget || el.classList.contains('scene')) {
          clearSelection()
          setSelectedNodeIds(new Set())
          closeUnzip()
        }
      }}
      onDoubleClick={handleDoubleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="debug-overlay">
        <div className="prototype-stats compact">
          <span>Selection: {frame.selectedNodeId ?? 'none'}</span>
          <span>Depth: {stack.length - 1}</span>
          <span>Model: {model.label}</span>
          <span>Progress: {frame.snapshot.progress.toFixed(2)}</span>
          <button
            className="debug-toggle"
            type="button"
            onClick={() => setDebugOpen((v) => !v)}
          >
            {debugOpen ? 'Hide Debug' : 'Show Debug'}
          </button>
        </div>
        {debugOpen && (
          <div className="prototype-stats details">
            <span>Mode: {frame.snapshot.handoffMode}</span>
            <span>Camera: {frame.snapshot.cameraScale.toFixed(2)}</span>
            <span>Inflation: {frame.snapshot.nodeInflation.toFixed(2)}</span>
            <span>Paused: {isPaused ? 'yes' : 'no'}</span>
          </div>
        )}
      </div>

      {!frame.selectedNodeId && (
        <div className="empty-hint">Click a node to select, then scroll to zoom in.</div>
      )}

      {mpdOptions && mpdOptions.length > 1 && (
        <MpdDial
          options={mpdOptions}
          activeIndex={mpdActiveIndex}
          onSelect={(idx, direction) => {
            const newModelId = mpdOptions[idx].id

            // --- Node-level: switch MPD with curtain animation ---
            if (isNodeLevelMpd) {
              // First entry (default) = restore original model
              const isDefault = idx === 0
              const targetId = isDefault && frame.nodeMpdOriginalModelId
                ? frame.nodeMpdOriginalModelId
                : newModelId
              // Skip if already showing this model
              if (targetId === frame.modelId) return

              // Compute pan offset to keep twin node anchored at same screen position
              // After switch, centering auto-tracks the twin, so we only need to
              // compensate for the position delta between old node and twin.
              let alignPan: { x: number; y: number } | undefined
              if (frame.selectedNodeId) {
                const oldNode = model.nodes.find((n) => n.id === frame.selectedNodeId)
                const newModel = storeGetModel(targetId)
                const twinNode = newModel?.nodes.find((n) => n.id === frame.selectedNodeId)
                if (oldNode && twinNode) {
                  const cs = frame.snapshot.cameraScale
                  const np = frame.snapshot.nodeProgress
                  const dx = (twinNode.x - oldNode.x) / 100 * vpSize.w * cs * (np - 1)
                  const dy = (twinNode.y - oldNode.y) / 100 * vpSize.h * cs * (np - 1)
                  alignPan = {
                    x: frame.panOffset.x + dx,
                    y: frame.panOffset.y + dy,
                  }
                }
              }

              const oldModel = model
              const oldStyle = { ...sceneStyle }
              cancelAnimationFrame(curtainRaf.current)
              flushSync(() => {
                setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, progress: 0, direction })
              })
              switchNodeMpd(targetId, nodeDialIds!, alignPan)
              const startTime = performance.now()
              const animate = () => {
                const elapsed = performance.now() - startTime
                const t = Math.min(elapsed / 500, 1)
                const eased = t * t * (3 - 2 * t)
                setMpdCurtain((prev) => prev ? { ...prev, progress: eased } : null)
                if (t < 1) {
                  curtainRaf.current = requestAnimationFrame(animate)
                } else {
                  setMpdCurtain(null)
                }
              }
              curtainRaf.current = requestAnimationFrame(animate)
              return
            }

            // --- Frame-level: switch the whole view with curtain animation ---
            if (newModelId === frame.modelId) return

            // Compute pan offset to align twin nodes across dimensions
            let alignPan: { x: number; y: number } = { x: 0, y: 0 }
            if (frame.selectedNodeId) {
              const oldNode = model.nodes.find((n) => n.id === frame.selectedNodeId)
              const newModel = storeGetModel(newModelId)
              const twinNode = newModel?.nodes.find((n) => n.id === frame.selectedNodeId)
              if (oldNode && twinNode) {
                const cs = frame.snapshot.cameraScale
                const np = frame.snapshot.nodeProgress
                let cx = 0, cy = 0
                if (selectedNode) {
                  cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * cs
                  cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * cs
                }
                // Old node screen position (relative to viewport center)
                const oldScreenX = cx + frame.panOffset.x + cs * (oldNode.x / 100 - 0.5) * vpSize.w
                const oldScreenY = cy + frame.panOffset.y + cs * (oldNode.y / 100 - 0.5) * vpSize.h
                // New frame: scale=1, no centering → solve for panOffset
                alignPan = {
                  x: oldScreenX - (twinNode.x / 100 - 0.5) * vpSize.w,
                  y: oldScreenY - (twinNode.y / 100 - 0.5) * vpSize.h,
                }
              }
            }

            // Capture current state for curtain
            const oldModel = model
            const oldStyle = { ...sceneStyle }
            cancelAnimationFrame(curtainRaf.current)
            // flushSync guarantees the clip-path wrapper is in the DOM
            // before switchFrameMpd changes the model, preventing a
            // single unclipped frame where all nodes would visibly jump.
            flushSync(() => {
              setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, progress: 0, direction })
            })
            switchFrameMpd(newModelId, alignPan)
            // Animate curtain from 0 → 1
            const startTime = performance.now()
            const animate = () => {
              const elapsed = performance.now() - startTime
              const t = Math.min(elapsed / 500, 1)
              const eased = t * t * (3 - 2 * t) // smoothstep
              setMpdCurtain((prev) => prev ? { ...prev, progress: eased } : null)
              if (t < 1) {
                curtainRaf.current = requestAnimationFrame(animate)
              } else {
                setMpdCurtain(null)
              }
            }
            curtainRaf.current = requestAnimationFrame(animate)
          }}
        />
      )}

      <div className="editor-toolbar">
        <button
          type="button"
          className="toolbar-btn"
          disabled={!(undoStacks[frame.modelId]?.length)}
          onClick={() => undo(frame.modelId)}
          title="Undo (Ctrl+Z)"
        >&#x21A9; Undo</button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={!(redoStacks[frame.modelId]?.length)}
          onClick={() => redo(frame.modelId)}
          title="Redo (Ctrl+Shift+Z)"
        >&#x21AA; Redo</button>
        <span className="toolbar-sep" />
        <button
          type="button"
          className="toolbar-btn"
          disabled={!frame.selectedNodeId}
          onClick={() => { if (frame.selectedNodeId) { removeNode(frame.modelId, frame.selectedNodeId); clearSelection() } }}
          title="Delete selected node (Del)"
        >&#x2715; Delete</button>
        <span className="toolbar-sep" />
        <button
          type="button"
          className="toolbar-btn"
          disabled={isUntangling}
          onClick={handleUntangle}
          title="Auto-untangle crossed connections"
        >{isUntangling ? '⟳ Untangling…' : '⟳ Untangle'}</button>
        <span className="toolbar-sep" />
        <button
          type="button"
          className={`toolbar-btn${selectMode ? ' toolbar-btn-active' : ''}`}
          onClick={() => setSelectMode(!selectMode)}
          title="Toggle selection mode (drag to select multiple nodes)"
        >{selectMode ? '⬚ Select' : '⬚ Select'}</button>
        <span className="toolbar-sep" />
        <button
          type="button"
          className="toolbar-btn"
          onClick={handleSave}
          title="Save project (JSON)"
        >&#x1F4BE; Save</button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Load project (JSON)"
        >&#x1F4C2; Load</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleLoad}
        />
      </div>

      {/* During MPD curtain: render old model in a clip wrapper (no transform → viewport coords) */}
      {mpdCurtain && (
        <div style={{
          position: 'absolute', inset: 0,
          clipPath: mpdCurtain.direction === 'left'
            ? `inset(0 ${mpdCurtain.progress * 100}% 0 0)`
            : `inset(0 0 0 ${mpdCurtain.progress * 100}%)`,
        }}>
          <div
            className="scene"
            style={mpdCurtain.oldSceneStyle}
          >
            <ModelSceneContent
              model={mpdCurtain.oldModel}
              selectedNodeId={null}
              childModel={undefined}
              progress={0}
              vpSize={vpSize}
              onSelectNode={() => {}}
              onDoubleClickNode={() => {}}
              onClickConnection={() => {}}
              onNodeDragStart={() => {}}
              onConnectionDragStart={() => {}}
              draggingNodeId={null}
              editingNodeId={null}
              onFinishEditing={() => {}}
              onLiveEditLabel={() => {}}
              connectionDraft={null}
              unzipGap={null}
            />
          </div>
        </div>
      )}

      {/* New/live scene – clip wrapper sits outside the transform so clip is in viewport coords */}
      <div style={{
        position: 'absolute', inset: 0,
        ...(mpdCurtain ? {
          clipPath: mpdCurtain.direction === 'left'
            ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
            : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`,
        } : {}),
      }}>
      <div
        className="scene"
        style={sceneStyle}
      >
        <ModelSceneContent
          model={model}
          selectedNodeId={frame.selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          childModel={childModel}
          progress={p}
          vpSize={vpSize}
          onSelectNode={handleSelectNode}
          onDoubleClickNode={(nodeId) => {
            beginEditNode(frame.modelId)
            setEditingNodeId(nodeId)
          }}
          onClickConnection={openUnzip}
          onNodeDragStart={handleNodeDragStart}
          onConnectionDragStart={handleConnectionDragStart}
          draggingNodeId={draggingNodeId}
          draggingMultiIds={multiDragOffsetsRef.current.size > 0 ? selectedNodeIds : undefined}
          editingNodeId={editingNodeId}
          noTransition={!!mpdCurtain}
          onFinishEditing={(nodeId, label) => {
            if (label.trim()) {
              // Label is already in the store from onLiveEditLabel; just trim whitespace
              setNodeLabelSilent(frame.modelId, nodeId, label.trim())
            } else {
              removeNode(frame.modelId, nodeId)
            }
            setEditingNodeId(null)
          }}
          onLiveEditLabel={(nodeId, label) => {
            // Live-update the label in the store so node size recalcs properly (no undo push)
            setNodeLabelSilent(frame.modelId, nodeId, label)
          }}
          connectionDraft={connectionDraft}
          unzipGap={unzipDisplayKey ? {
            connectionKey: unzipDisplayKey,
            progress: unzipAnimProgress,
            popupSize,
            connectionAngle: (() => {
              if (!activeUnzipPopup) return 0
              const conn = model.connections.find(
                (c) => `${c.from}->${c.to}` === activeUnzipPopup.connectionKey,
              )
              if (!conn) return 0
              const fn = model.nodes.find((n) => n.id === conn.from)
              const tn = model.nodes.find((n) => n.id === conn.to)
              if (!fn || !tn) return 0
              return Math.atan2((tn.y - fn.y) * vpSize.h, (tn.x - fn.x) * vpSize.w)
            })()
          } : null}
        />
        {activeUnzipPopup && (() => {
          const conn = model.connections.find(
            (c) => `${c.from}->${c.to}` === activeUnzipPopup.connectionKey,
          )
          if (!conn) return null
          const fromNode = model.nodes.find((n) => n.id === conn.from)
          const toNode = model.nodes.find((n) => n.id === conn.to)
          const angle = fromNode && toNode
            ? Math.atan2(
                (toNode.y - fromNode.y) * vpSize.h,
                (toNode.x - fromNode.x) * vpSize.w,
              )
            : 0
          return (
            <UnzipPopup
              connectionKey={activeUnzipPopup.connectionKey}
              level={activeUnzipPopup.level}
              evidence={conn.evidence ?? []}
              anchorX={activeUnzipPopup.anchorX}
              anchorY={activeUnzipPopup.anchorY}
              animProgress={unzipAnimProgress}
              connectionAngle={angle}
              onSizeChange={handlePopupSizeChange}
              onUpdateEvidence={(evidence) => {
                updateConnectionEvidence(frame.modelId, conn.from, conn.to, evidence)
              }}
            />
          )
        })()}
      </div>
      </div>

      {mpdCurtain && (
        <div
          className="mpd-curtain-line"
          style={{
            left: mpdCurtain.direction === 'left'
              ? `${(1 - mpdCurtain.progress) * 100}%`
              : `${mpdCurtain.progress * 100}%`,
          }}
        />
      )}

      {selectionRect && (() => {
        const rect = viewportRef.current?.getBoundingClientRect()
        if (!rect) return null
        const cs = frame.snapshot.cameraScale
        let cx = 0, cy = 0
        if (selectedNode) {
          const np = frame.snapshot.nodeProgress
          cx = np * (0.5 - selectedNode.x / 100) * vpSize.w * cs
          cy = np * (0.5 - selectedNode.y / 100) * vpSize.h * cs
        }
        const toScreen = (pctX: number, pctY: number) => ({
          x: (pctX / 100) * vpSize.w * cs + cx + frame.panOffset.x,
          y: (pctY / 100) * vpSize.h * cs + cy + frame.panOffset.y,
        })
        const s = toScreen(selectionRect.startX, selectionRect.startY)
        const e = toScreen(selectionRect.endX, selectionRect.endY)
        const left = Math.min(s.x, e.x)
        const top = Math.min(s.y, e.y)
        const width = Math.abs(e.x - s.x)
        const height = Math.abs(e.y - s.y)
        return (
          <div
            className="selection-rect"
            style={{ left, top, width, height }}
          />
        )
      })()}

      <LeftSidebar />
      <RightSidebar
        model={model}
        selectedNode={selectedNode}
        selectedConnection={selectedNode ? undefined : (unzipPopup
          ? model?.connections.find(c => `${c.from}->${c.to}` === unzipPopup.connectionKey)
          : undefined
        )}
        gridSnap={gridSnap}
        onSetGridSnap={setGridSnap}
        onUpdateNodeShape={(nodeId, shape) => updateNodeShape(frame.modelId, nodeId, shape)}
        onUpdateNodeProps={(nodeId, props) => updateNodeProps(frame.modelId, nodeId, props)}
        allModels={storeModels}
        onRegisterModel={registerModel}
        onUpdateModelLabel={updateModelLabel}
      />
    </div>
  )
}

/** Renders all nodes and connections for a model */
function ModelSceneContent({
  model,
  selectedNodeId,
  selectedNodeIds,
  childModel,
  progress,
  vpSize,
  onSelectNode,
  onDoubleClickNode,
  onClickConnection,
  onNodeDragStart,
  onConnectionDragStart,
  draggingNodeId,
  draggingMultiIds,
  editingNodeId,
  onFinishEditing,
  onLiveEditLabel,
  connectionDraft,
  unzipGap,
  noTransition,
}: {
  model: Model
  selectedNodeId: string | null
  selectedNodeIds?: Set<string>
  childModel: Model | undefined
  progress: number
  vpSize: { w: number; h: number }
  onSelectNode: (id: string) => void
  onDoubleClickNode: (id: string) => void
  onClickConnection: (connectionKey: string, anchorX: number, anchorY: number) => void
  onNodeDragStart: (nodeId: string, e: React.PointerEvent) => void
  onConnectionDragStart: (nodeId: string, e: React.PointerEvent) => void
  draggingNodeId: string | null
  draggingMultiIds?: Set<string>
  editingNodeId: string | null
  onFinishEditing: (nodeId: string, label: string) => void
  onLiveEditLabel: (nodeId: string, label: string) => void
  connectionDraft: { fromId: string; fromX: number; fromY: number; toX: number; toY: number } | null
  unzipGap: { connectionKey: string; progress: number; popupSize: { w: number; h: number } | null; connectionAngle: number } | null
  noTransition?: boolean
}) {
  // Track actual measured node sizes for accurate anchor placement
  const nodeSizesRef = useRef<Map<string, { w: number; h: number }>>(new Map())
  const [sizeGen, setSizeGen] = useState(0)
  const handleNodeResize = useCallback((id: string, size: { w: number; h: number }) => {
    const map = nodeSizesRef.current
    const prev = map.get(id)
    if (!prev || prev.w !== size.w || prev.h !== size.h) {
      map.set(id, size)
      setSizeGen(g => g + 1)
    }
  }, [])

  // Compute per-node spread offsets: when a popup needs more room than the
  // connection length provides, push both endpoint nodes apart symmetrically.
  const spreadOffsets = useMemo(() => {
    const offsets: Record<string, { dx: number; dy: number }> = {}
    if (!unzipGap || !unzipGap.popupSize || unzipGap.progress < 0.001) return offsets

    const conn = model.connections.find(
      (c) => `${c.from}->${c.to}` === unzipGap.connectionKey,
    )
    if (!conn) return offsets
    const fromN = model.nodes.find((n) => n.id === conn.from)
    const toN = model.nodes.find((n) => n.id === conn.to)
    if (!fromN || !toN) return offsets

    // Connection length in pixels
    const dxPx = (toN.x - fromN.x) * vpSize.w / 100
    const dyPx = (toN.y - fromN.y) * vpSize.h / 100
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
    if (lenPx < 1) return offsets

    const angle = unzipGap.connectionAngle
    const cosA = Math.abs(Math.cos(angle))
    const sinA = Math.abs(Math.sin(angle))

    // Popup's extent along the connection axis + padding for zipper corners
    const alongExtent =
      (unzipGap.popupSize.w / 2) * cosA +
      (unzipGap.popupSize.h / 2) * sinA +
      40 // padding for zipper entry/exit + corner radius

    // How much total room is needed vs available
    const needed = alongExtent * 2
    const deficit = needed - lenPx
    if (deficit <= 0) return offsets

    // Each node moves outward by half the deficit (in percentage coordinates)
    const halfDeficit = (deficit / 2 + 8) * unzipGap.progress // +8 for breathing room
    const ux = dxPx / lenPx // unit along connection
    const uy = dyPx / lenPx
    offsets[conn.from] = {
      dx: -ux * halfDeficit * 100 / vpSize.w,
      dy: -uy * halfDeficit * 100 / vpSize.h,
    }
    offsets[conn.to] = {
      dx: ux * halfDeficit * 100 / vpSize.w,
      dy: uy * halfDeficit * 100 / vpSize.h,
    }
    return offsets
  }, [model, unzipGap, vpSize])

  // Helper: get spread-adjusted position for a node
  const pos = (node: ModelNode) => {
    const off = spreadOffsets[node.id]
    return off
      ? { x: node.x + off.dx, y: node.y + off.dy }
      : { x: node.x, y: node.y }
  }

  // Compute edge-anchored connection endpoints
  const anchors = useMemo(
    () => computeEdgeAnchors(model.nodes, model.connections, vpSize.w, vpSize.h, pos, nodeSizesRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, spreadOffsets, vpSize, sizeGen],
  )

  return (
    <>
      <svg className="child-scene-connections">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(37, 96, 149, 0.45)" />
          </marker>
          <marker id="arrowhead-evidence" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(37, 96, 149, 0.65)" />
          </marker>
        </defs>
        {model.connections.map((c) => {
          const fromN = model.nodes.find((n) => n.id === c.from)
          const toN = model.nodes.find((n) => n.id === c.to)
          if (!fromN || !toN) return null
          const key = `${c.from}->${c.to}`
          const hasEvidence = !!c.evidence?.length
          const a = anchors[key]
          if (!a) return null
          // Anchor midpoint (for popup positioning)
          const midX = (a.fx + a.tx) / 2
          const midY = (a.fy + a.ty) / 2
          const isUnzipping = unzipGap?.connectionKey === key
          const gapT = isUnzipping ? unzipGap.progress : 0
          return (
            <g key={key}>
              <line
                x1={`${a.fx}%`} y1={`${a.fy}%`}
                x2={`${a.tx}%`} y2={`${a.ty}%`}
                className="connection-hit-area"
                onClick={(e) => {
                  e.stopPropagation()
                  onClickConnection(key, midX, midY)
                }}
              />
              <ConnectionLine
                fromX={a.fx} fromY={a.fy}
                toX={a.tx} toY={a.ty}
                hasEvidence={hasEvidence}
                gapProgress={gapT}
                vpSize={vpSize}
                popupSize={isUnzipping ? unzipGap?.popupSize ?? null : null}
                connectionAngle={isUnzipping ? unzipGap?.connectionAngle ?? 0 : 0}
              />
            </g>
          )
        })}
        {connectionDraft && (
          <line
            x1={`${connectionDraft.fromX}%`} y1={`${connectionDraft.fromY}%`}
            x2={`${connectionDraft.toX}%`} y2={`${connectionDraft.toY}%`}
            className="connection-draft"
          />
        )}
      </svg>
      {model.nodes.map((node) => {
        const p = pos(node)
        return (
          <SceneNode
            key={node.id}
            node={node}
            posX={p.x}
            posY={p.y}
            isSelected={node.id === selectedNodeId || (selectedNodeIds?.has(node.id) ?? false)}
            isMultiSelected={selectedNodeIds?.has(node.id) ?? false}
            isZooming={node.id === selectedNodeId && progress > 0}
            progress={node.id === selectedNodeId ? progress : 0}
            childModel={node.id === selectedNodeId ? childModel : undefined}
            vpSize={vpSize}
            onSelect={() => onSelectNode(node.id)}
            onDoubleClick={() => onDoubleClickNode(node.id)}
            onDragStart={(e) => onNodeDragStart(node.id, e)}
            onConnectionDragStart={(e) => onConnectionDragStart(node.id, e)}
            isDragging={node.id === draggingNodeId || (draggingMultiIds?.has(node.id) ?? false) || !!noTransition}
            isEditing={node.id === editingNodeId}
            onFinishEditing={(label) => onFinishEditing(node.id, label)}
            onLiveEditLabel={(label) => onLiveEditLabel(node.id, label)}
            onResize={(size) => handleNodeResize(node.id, size)}
          />
        )
      })}
    </>
  )
}

/** Connection line that bows outward into a zipper-bag shape during unzip */
function ConnectionLine({
  fromX, fromY, toX, toY, hasEvidence, gapProgress, vpSize, popupSize, connectionAngle,
}: {
  fromX: number; fromY: number
  toX: number; toY: number
  hasEvidence: boolean
  gapProgress: number
  vpSize: { w: number; h: number }
  popupSize: { w: number; h: number } | null
  connectionAngle: number
}) {
  const lineClass = hasEvidence ? 'connection-line has-evidence' : 'connection-line'

  if (gapProgress < 0.001) {
    const marker = hasEvidence ? 'url(#arrowhead-evidence)' : 'url(#arrowhead)'
    // Shorten line so it ends at arrowhead base (refX=0).
    // Arrowhead extends forward from line endpoint to original target (node edge).
    // Marker size: 8 markerUnits × strokeWidth(2) = 16px
    const dxPx = (toX - fromX) * vpSize.w / 100
    const dyPx = (toY - fromY) * vpSize.h / 100
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
    const arrowLenPx = 16
    let adjToX = toX, adjToY = toY
    if (lenPx > arrowLenPx * 2) {
      const ratio = arrowLenPx / lenPx
      adjToX = toX - (toX - fromX) * ratio
      adjToY = toY - (toY - fromY) * ratio
    }
    return (
      <line
        x1={`${fromX}%`} y1={`${fromY}%`}
        x2={`${adjToX}%`} y2={`${adjToY}%`}
        className={lineClass}
        markerEnd={marker}
      />
    )
  }

  // Compute in screen-pixel space for correct aspect-ratio perpendicular
  const fxPx = fromX * vpSize.w / 100
  const fyPx = fromY * vpSize.h / 100
  const txPx = toX * vpSize.w / 100
  const tyPx = toY * vpSize.h / 100

  const dxPx = txPx - fxPx
  const dyPx = tyPx - fyPx
  const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
  if (lenPx < 1) return null

  // Unit vectors in pixel space
  const alongX = dxPx / lenPx
  const alongY = dyPx / lenPx
  const perpX = -alongY
  const perpY = alongX

  const midXPx = (fxPx + txPx) / 2
  const midYPx = (fyPx + tyPx) / 2

  // Trace the actual popup rectangle edges rather than a rotated bounding box.
  // For each track (+1 / -1), find the popup corners on that side of the
  // connection line and route the path around them with rounded corners.

  const padding = 16 // px clearance beyond popup edge

  function buildTrackForPopup(sign: number): string {
    const hw = (popupSize!.w / 2 + padding) * gapProgress
    const hh = (popupSize!.h / 2 + padding) * gapProgress

    // Ray from mid along the connection direction hits the popup boundary at parameter t
    let t = Infinity
    if (Math.abs(alongX) > 1e-9) t = Math.min(t, hw / Math.abs(alongX))
    if (Math.abs(alongY) > 1e-9) t = Math.min(t, hh / Math.abs(alongY))
    // Don't let entry/exit overshoot connection endpoints
    t = Math.min(t, lenPx / 2 - 1)
    if (t <= 0) return `M ${fxPx} ${fyPx} L ${txPx} ${tyPx}`

    // Entry (toward 'from') and exit (toward 'to') on the popup boundary
    const entAbs = { x: midXPx - alongX * t, y: midYPx - alongY * t }
    const extAbs = { x: midXPx + alongX * t, y: midYPx + alongY * t }

    // Which edge is the exit point on?
    // 0=top(y=-hh), 1=right(x=+hw), 2=bottom(y=+hh), 3=left(x=-hw)
    const extRx = alongX * t, extRy = alongY * t
    const eps = 0.5
    let exitEdge: number
    if (Math.abs(extRx - hw) < eps) exitEdge = 1
    else if (Math.abs(extRx + hw) < eps) exitEdge = 3
    else if (Math.abs(extRy - hh) < eps) exitEdge = 2
    else exitEdge = 0
    const entryEdge = (exitEdge + 2) % 4

    // Corners in CW order: TL(0), TR(1), BR(2), BL(3)
    const cornerPos: [number, number][] = [
      [midXPx - hw, midYPx - hh],
      [midXPx + hw, midYPx - hh],
      [midXPx + hw, midYPx + hh],
      [midXPx - hw, midYPx + hh],
    ]

    // Edge e runs CW from corner e to corner (e+1)%4.
    // Collect corners going CW from entry edge to exit edge.
    const cwIdx: number[] = []
    let e = entryEdge
    while (true) {
      cwIdx.push((e + 1) % 4)
      e = (e + 1) % 4
      if (e === exitEdge) break
    }
    // CCW corners
    const ccwIdx: number[] = []
    e = entryEdge
    while (true) {
      ccwIdx.push(e)
      e = (e - 1 + 4) % 4
      if (e === exitEdge) break
    }

    // Determine which direction corresponds to +perp side
    const cwPerp = cwIdx.reduce((s, ci) =>
      s + (cornerPos[ci][0] - midXPx) * perpX + (cornerPos[ci][1] - midYPx) * perpY, 0)
    const myIdx = (cwPerp * sign > 0) ? cwIdx : ccwIdx
    const myCorners = myIdx.map(ci => ({ x: cornerPos[ci][0], y: cornerPos[ci][1] }))

    if (myCorners.length === 0) {
      return `M ${fxPx} ${fyPx} L ${txPx} ${tyPx}`
    }

    // Waypoints: from, entry, popup-corners..., exit, to
    const wp = [
      { x: fxPx, y: fyPx },
      entAbs,
      ...myCorners,
      extAbs,
      { x: txPx, y: tyPx },
    ]

    // Build path with quadratic-bezier rounded corners at indices 1..length-2
    const cr = Math.min(hw, hh, 28)
    let path = `M ${wp[0].x} ${wp[0].y}`
    for (let i = 1; i < wp.length; i++) {
      if (i < wp.length - 1) {
        const prev = wp[i - 1], curr = wp[i], next = wp[i + 1]
        let dx1 = curr.x - prev.x, dy1 = curr.y - prev.y
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
        let dx2 = next.x - curr.x, dy2 = next.y - curr.y
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
        if (len1 < 0.5 || len2 < 0.5) { path += ` L ${curr.x} ${curr.y}`; continue }
        dx1 /= len1; dy1 /= len1
        dx2 /= len2; dy2 /= len2
        const r = Math.min(cr, len1 / 2, len2 / 2)
        path += ` L ${curr.x - dx1 * r} ${curr.y - dy1 * r}`
        path += ` Q ${curr.x} ${curr.y} ${curr.x + dx2 * r} ${curr.y + dy2 * r}`
      } else {
        path += ` L ${wp[i].x} ${wp[i].y}`
      }
    }
    return path
  }

  // Fallback track for when popup size isn't known yet
  function buildFallbackTrack(sign: number): string {
    const bow = Math.min(lenPx * 0.18, 110) * gapProgress
    const cpx = midXPx + perpX * bow * sign
    const cpy = midYPx + perpY * bow * sign
    const sAx = fxPx + alongX * lenPx * 0.30
    const sAy = fyPx + alongY * lenPx * 0.30
    const sBx = fxPx + alongX * lenPx * 0.70
    const sBy = fyPx + alongY * lenPx * 0.70
    return `M ${fxPx} ${fyPx} L ${sAx} ${sAy} Q ${cpx} ${cpy} ${sBx} ${sBy} L ${txPx} ${tyPx}`
  }

  const hasPopup = popupSize && popupSize.w > 0 && popupSize.h > 0
  const d1 = hasPopup ? buildTrackForPopup(+1) : buildFallbackTrack(+1)
  const d2 = hasPopup ? buildTrackForPopup(-1) : buildFallbackTrack(-1)

  return (
    <>
      <path d={d1} className={lineClass} fill="none" />
      <path d={d2} className={lineClass} fill="none" />
    </>
  )
}

/** A single node that can expand its canvas when zooming */
function SceneNode({
  node,
  posX,
  posY,
  isSelected,
  isMultiSelected,
  isZooming,
  progress,
  childModel,
  vpSize,
  onSelect,
  onDoubleClick,
  onDragStart,
  onConnectionDragStart,
  isDragging,
  isEditing,
  onFinishEditing,
  onLiveEditLabel,
  onResize,
}: {
  node: ModelNode
  posX: number
  posY: number
  isSelected: boolean
  isMultiSelected?: boolean
  isZooming: boolean
  progress: number
  childModel: Model | undefined
  vpSize: { w: number; h: number }
  onSelect: () => void
  onDoubleClick: () => void
  onDragStart: (e: React.PointerEvent) => void
  onConnectionDragStart: (e: React.PointerEvent) => void
  isDragging: boolean
  isEditing: boolean
  onFinishEditing: (label: string) => void
  onLiveEditLabel: (label: string) => void
  onResize: (size: { w: number; h: number }) => void
}) {
  const labelRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const finishedRef = useRef(false)
  const [baseSize, setBaseSize] = useState({ w: NODE_MIN_W, h: NODE_MIN_H })

  // Measure label size (both for display and editing)
  const measureLabel = useCallback(() => {
    const el = isEditing ? editRef.current : labelRef.current
    if (!el) return
    const pad = 32 + 4
    const vPad = 28 + 4
    setBaseSize({
      w: Math.max(NODE_MIN_W, el.scrollWidth + pad),
      h: Math.max(NODE_MIN_H, el.scrollHeight + vPad),
    })
  }, [isEditing])

  useEffect(() => {
    if (progress > 0) return
    measureLabel()
  }, [node.label, measureLabel, progress])

  // Report measured size to parent for anchor computation
  useEffect(() => {
    onResize(baseSize)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSize])

  const targetW = vpSize.w / CAMERA_SCALE_FINAL
  const targetH = vpSize.h / CAMERA_SCALE_FINAL

  let nodeW = baseSize.w + (targetW - baseSize.w) * progress
  let nodeH = baseSize.h + (targetH - baseSize.h) * progress

  const shape = node.shape ?? 'rounded-rect'

  // Circle enforces equal dimensions
  if (shape === 'circle' && progress === 0) {
    const maxDim = Math.max(nodeW, nodeH)
    nodeW = maxDim
    nodeH = maxDim
  }

  const chromeFade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1

  // Node style properties with defaults
  const cellColor = node.cellColor ?? '#f4f8fd'
  const membraneColor = node.membraneColor ?? '#365f8f'
  const membraneVisible = node.membraneVisible !== false

  // Parse hex to rgb components for alpha blending with chromeFade
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '')
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    }
  }
  const cellRgb = hexToRgb(cellColor)
  const memRgb = hexToRgb(membraneColor)
  // Lighter shade for gradient end
  const cellEndRgb = {
    r: Math.max(0, cellRgb.r - 21),
    g: Math.max(0, cellRgb.g - 15),
    b: Math.max(0, cellRgb.b - 8),
  }

  // Shape-specific clip-path for complex shapes
  const clipPaths: Partial<Record<string, string>> = {
    diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
    parallelogram: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
    triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  }
  const clipPath = clipPaths[shape]

  // Shape-specific border-radius
  let borderRadius: number | string = 18 * chromeFade
  if (shape === 'rectangle') borderRadius = 0
  else if (shape === 'oval' || shape === 'circle') borderRadius = '50%'

  const shadow = chromeFade > 0.01
    ? `0 10px 30px rgba(19, 41, 73, ${0.2 * chromeFade})`
    : 'none'

  // Positioning styles (shared for both approaches)
  const positionStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${posX}%`,
    top: `${posY}%`,
    transition: isDragging ? 'none' : 'left 0.35s cubic-bezier(0.25,0.1,0.25,1), top 0.35s cubic-bezier(0.25,0.1,0.25,1)',
    width: nodeW,
    minWidth: shape === 'circle' ? nodeW : baseSize.w,
    height: nodeH,
    minHeight: shape === 'circle' ? nodeH : baseSize.h,
    transform: 'translate(-50%, -50%)',
    zIndex: isZooming ? 10 : 1,
  }

  // Visual styles for the article
  const vizStyle: React.CSSProperties = {
    borderColor: clipPath ? 'transparent'
      : (membraneVisible || isSelected)
        ? `rgba(${isSelected ? '14, 79, 143' : `${memRgb.r}, ${memRgb.g}, ${memRgb.b}`}, ${chromeFade})`
      : 'transparent',
    background: chromeFade > 0.01
      ? `linear-gradient(145deg, rgba(${cellRgb.r},${cellRgb.g},${cellRgb.b},${chromeFade}), rgba(${cellEndRgb.r},${cellEndRgb.g},${cellEndRgb.b},${chromeFade}))`
      : 'transparent',
    boxShadow: clipPath ? 'none' : shadow,
    filter: clipPath && chromeFade > 0.01
      ? `drop-shadow(${shadow})${isSelected ? ' drop-shadow(0 0 3px rgba(44, 120, 188, 0.6))' : ''}`
      : undefined,
    borderRadius,
    clipPath,
    padding: chromeFade > 0.01 ? `${14 * chromeFade}px ${16 * chromeFade}px` : 0,
  }

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && editRef.current) {
      finishedRef.current = false
      const el = editRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      // Auto-size height for multiline content
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
      measureLabel()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  const getEditText = (): string => {
    if (!editRef.current) return ''
    return editRef.current.value.replace(/\n+$/, '')
  }

  const handleInput = () => {
    if (editRef.current) {
      editRef.current.style.height = 'auto'
      editRef.current.style.height = editRef.current.scrollHeight + 'px'
    }
    measureLabel()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finishedRef.current = true
      onFinishEditing(getEditText())
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      finishedRef.current = true
      onFinishEditing('')
    }
    // Shift+Enter inserts a line break (default textarea behavior)
  }

  const articleContent = (
    <>
      {isEditing ? (
        <textarea
          ref={editRef}
          className="host-label host-label-editing"
          defaultValue={node.label}
          rows={1}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!finishedRef.current) {
              finishedRef.current = true
              onFinishEditing(getEditText())
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          ref={labelRef}
          className={`host-label${node.label.includes('\n') ? ' multiline' : ''}`}
          style={{ opacity: chromeFade, visibility: chromeFade > 0.01 ? 'visible' : 'hidden' }}
        >
          {node.label ? (node.label.includes('\n')
            ? node.label.split('\n').map((line, i, arr) => (
              i < arr.length - 1
                ? <span key={i}>{line}<br /></span>
                : <span key={i}>{line}</span>
            ))
            : node.label
          ) : '\u00A0'}
        </div>
      )}
      {isZooming && childModel && (
        <div className="child-model">
          <ChildModelPreview
            model={childModel}
            scale={nodeW / vpSize.w}
            vpSize={vpSize}
          />
        </div>
      )}
    </>
  )

  const articleEventHandlers = {
    onClick: (event: React.MouseEvent) => { event.stopPropagation(); onSelect() },
    onDoubleClick: (event: React.MouseEvent) => { event.stopPropagation(); if (!isEditing) onDoubleClick() },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button === 0 && !isEditing) onDragStart(e)
      else if (e.button === 2) onConnectionDragStart(e)
    },
  }

  // Polygon shapes use a wrapper div so the SVG border is not clipped
  if (clipPath) {
    return (
      <div style={{ ...positionStyle, pointerEvents: 'none' }}>
        {chromeFade > 0.01 && membraneVisible && (
          <svg
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <polygon
              points={shapeSvgPoints(shape, nodeW, nodeH)}
              fill="none"
              stroke={isSelected
                ? `rgba(14, 79, 143, ${chromeFade})`
                : `rgba(${memRgb.r}, ${memRgb.g}, ${memRgb.b}, ${chromeFade})`}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {isMultiSelected && (
          <svg
            style={{
              position: 'absolute',
              left: -5,
              top: -5,
              width: 'calc(100% + 10px)',
              height: 'calc(100% + 10px)',
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            <polygon
              points={shapeSvgPoints(shape, nodeW + 10, nodeH + 10)}
              fill="none"
              stroke="rgba(37, 99, 235, 0.7)"
              strokeWidth={2}
              strokeDasharray="6 4"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <article
          className={`host-node${isSelected ? ' focused' : ''}`}
          style={{
            ...vizStyle,
            position: 'relative',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
          }}
          {...articleEventHandlers}
        >
          {articleContent}
        </article>
      </div>
    )
  }

  return (
    <article
      className={`host-node${isSelected ? ' focused' : ''}${isMultiSelected ? ' multi-selected' : ''}`}
      style={{ ...positionStyle, ...vizStyle }}
      {...articleEventHandlers}
    >
      {articleContent}
    </article>
  )
}

/** Preview of child model content inside a node canvas */
function ChildModelPreview({ model, scale, vpSize }: { model: Model; scale: number; vpSize: { w: number; h: number } }) {
  const identity = (n: ModelNode) => ({ x: n.x, y: n.y })
  const anchors = useMemo(
    () => computeEdgeAnchors(model.nodes, model.connections, vpSize.w, vpSize.h, identity),
    [model, vpSize],
  )

  return (
    <>
      <svg className="child-preview-connections">
        <defs>
          <marker id="arrowhead-preview" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(37, 96, 149, 0.45)" />
          </marker>
        </defs>
        {model.connections.map((c) => {
          const key = `${c.from}->${c.to}`
          const a = anchors[key]
          if (!a) return null
          // Shorten line so arrowhead tip lands at node edge (refX=0)
          // Marker size in container px = markerWidth(8) × strokeWidth(2×scale)
          // In vpSize-px (same units as anchors): 8 × 2 × scale × (vpSize.w/nodeW) = 16
          const dxPx = (a.tx - a.fx) * vpSize.w / 100
          const dyPx = (a.ty - a.fy) * vpSize.h / 100
          const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
          const arrowLenPx = 16
          let tx = a.tx, ty = a.ty
          if (lenPx > arrowLenPx * 2) {
            const ratio = arrowLenPx / lenPx
            tx = a.tx - (a.tx - a.fx) * ratio
            ty = a.ty - (a.ty - a.fy) * ratio
          }
          return (
            <line
              key={`${c.from}-${c.to}`}
              x1={`${a.fx}%`} y1={`${a.fy}%`}
              x2={`${tx}%`} y2={`${ty}%`}
              strokeWidth={2 * scale}
              markerEnd="url(#arrowhead-preview)"
            />
          )
        })}
      </svg>
      {model.nodes.map((node) => {
        const shape = node.shape ?? 'rounded-rect'
        const previewClipPaths: Partial<Record<string, string>> = {
          diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
          hexagon: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
          parallelogram: 'polygon(15% 0%, 100% 0%, 85% 100%, 0% 100%)',
          triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
        }
        const pClip = previewClipPaths[shape]
        let pRadius: string | number = 14
        if (shape === 'rectangle') pRadius = 0
        else if (shape === 'oval' || shape === 'circle') pRadius = '50%'

        const cellColor = node.cellColor ?? '#f4f8fd'
        const memColor = node.membraneColor ?? '#365f8f'
        const memVisible = node.membraneVisible !== false

        const hexToRgb = (hex: string) => {
          const h = hex.replace('#', '')
          return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) }
        }
        const cRgb = hexToRgb(cellColor)
        const cEnd = { r: Math.max(0, cRgb.r - 21), g: Math.max(0, cRgb.g - 15), b: Math.max(0, cRgb.b - 8) }

        const shapeStyle: React.CSSProperties = {
          borderRadius: pRadius,
          clipPath: pClip,
          borderColor: pClip ? 'transparent' : memVisible ? memColor : 'transparent',
          background: `linear-gradient(145deg, rgb(${cRgb.r},${cRgb.g},${cRgb.b}), rgb(${cEnd.r},${cEnd.g},${cEnd.b}))`,
          ...(shape === 'circle' ? { aspectRatio: '1', minWidth: 'fit-content' } : {}),
        }

        const labelContent = node.label.includes('\n')
          ? node.label.split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))
          : node.label

        const posStyle: React.CSSProperties = {
          left: `${node.x}%`,
          top: `${node.y}%`,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }

        // Polygon shapes need a wrapper with SVG border overlay
        if (pClip && memVisible) {
          const svgPolygonPoints: Record<string, string> = {
            diamond: '50,0 100,50 50,100 0,50',
            hexagon: '25,0 75,0 100,50 75,100 25,100 0,50',
            parallelogram: '15,0 100,0 85,100 0,100',
            triangle: '50,0 100,100 0,100',
          }
          return (
            <div
              key={node.id}
              className="child-scene-node-wrapper"
              style={posStyle}
            >
              <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polygon
                  points={svgPolygonPoints[shape] ?? ''}
                  fill="none"
                  stroke={memColor}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div
                className="child-scene-node"
                style={{
                  position: 'relative',
                  left: 0,
                  top: 0,
                  transform: 'none',
                  ...shapeStyle,
                }}
              >
                {labelContent}
              </div>
            </div>
          )
        }

        return (
          <div
            key={node.id}
            className="child-scene-node"
            style={{ ...posStyle, ...shapeStyle }}
          >
            {labelContent}
          </div>
        )
      })}
    </>
  )
}
