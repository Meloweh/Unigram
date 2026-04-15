import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CAMERA_SCALE_FINAL } from './hybridZoom'
import { type Model, type ModelConnection, type ModelNode, type NodeShape, type MediaNodeType, type ConnectionType, type ConnectionArrowStyle, type ConnectionDashStyle, type GridConfig } from './sampleModels'
import { UnzipPopup } from './UnzipPopup'
import { DEFAULT_GRID_SNAP, snapToGrid, useHybridZoomStore, type UnzipPopupState } from './useHybridZoomStore'
import { MpdDial } from './MpdDial'
import { LeftSidebar } from './LeftSidebar'
import { RightSidebar } from './RightSidebar'
import { FlowEffectEditor, type EffectEditorHostContext } from './FlowEffectEditor'
import { loadModel, loadModelById, exportBundle, importBundle, registerModelUrl, clearLoaderCache } from './modelLoader'
import { applyThemeToDOM, getTopicalPreset, resolvePalette } from './themes'
import { resolveBackground, type BackgroundConfig } from './backgrounds'
import { ParticleOverlay } from './ParticleOverlay'
import { ContentEditor } from './ContentEditor'
import { marked } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'

/** Fixed scene dimensions — decouples scene space from viewport size */
const SCENE_W = 1920
const SCENE_H = 1080
const SCENE_VP = { w: SCENE_W, h: SCENE_H } as const

/** Build CSS background-image for the grid based on config */
function gridBackgroundImage(cfg?: GridConfig): string {
  const color = cfg?.color || 'var(--ug-grid-dot)'
  const size = cfg?.size ?? 1
  const style = cfg?.style ?? 'dots'
  if (style === 'lines') {
    return `linear-gradient(${color} ${size}px, transparent ${size}px), linear-gradient(90deg, ${color} ${size}px, transparent ${size}px)`
  }
  if (style === 'dotted-lines') {
    return `repeating-linear-gradient(0deg, ${color} 0 ${size}px, transparent ${size}px ${size * 4}px), repeating-linear-gradient(90deg, ${color} 0 ${size}px, transparent ${size}px ${size * 4}px)`
  }
  // dots (default)
  return `radial-gradient(circle, ${color} ${size}px, transparent ${size}px)`
}

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

/** Cache AudioContext + AnalyserNode per media element so createMediaElementSource is only called once */
const audioCtxCache = new WeakMap<HTMLMediaElement, { ctx: AudioContext; analyser: AnalyserNode }>()

/** Minimum base dimensions fallback before label measured */
const NODE_MIN_W = 80
const NODE_MIN_H = 40

/** Auto-expand grid chunk size in percentage units */
const GRID_CHUNK = 20

/** Compute the dynamic grid extent from node positions (draw.io-style auto-expand).
 *  Extends in GRID_CHUNK increments beyond 0-100 when nodes are outside, shrinks when freed. */
function computeGridExtent(nodes: ModelNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
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
  // Locked node IDs — these must not move during any phase
  const lockedIds = new Set(nodes.filter(n => n.locked).map(n => n.id))

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
        if (lockedIds.has(cand.id)) continue
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
      if (lockedIds.has(nodes[i].id)) continue
      for (let j = i + 1; j < nodes.length; j++) {
        if (lockedIds.has(nodes[j].id)) continue
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
      if (lockedIds.has(n.id)) continue
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

  // Convert back to percentage and snap to grid (exclude locked nodes)
  const result: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    if (lockedIds.has(n.id)) continue
    const p = posOf(n.id)
    result[n.id] = {
      x: snapToGrid(p.x * 100 / vpW, gridSnapSize),
      y: snapToGrid(p.y * 100 / vpH, gridSnapSize),
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

export function PrototypeViewport() {
  const [debugOpen, setDebugOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 1920, h: 1080 })
  const vpSizeRef = useRef(vpSize)
  vpSizeRef.current = vpSize
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
    adjustFreeScale,
    setFreeScale,
    setPanOffset,
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
    updateConnectionType,
    updateConnectionProps,
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
    removeConnection,
    appThemeMode,
    modelCosmetics,
    setAppThemeMode,
    setModelCosmetics,
  } = useHybridZoomStore()

  const frame = currentFrame()
  const model = storeGetModel(frame.modelId)!
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const panOffsetRef = useRef(frame.panOffset)
  panOffsetRef.current = frame.panOffset
  const freeScaleRef = useRef(frame.freeScale)
  freeScaleRef.current = frame.freeScale

  // Apply theme palette to DOM whenever appThemeMode changes
  useEffect(() => {
    applyThemeToDOM(resolvePalette(appThemeMode))
    // Apply/remove topical CSS class on document root
    const topical = getTopicalPreset(appThemeMode)
    const root = document.documentElement
    // Remove all topical theme classes first
    root.classList.forEach((cls) => {
      if (cls.startsWith('theme-')) root.classList.remove(cls)
    })
    if (topical) root.classList.add(topical.cssClass)
  }, [appThemeMode])

  // Resolve per-model cosmetics
  const currentCosmetics = model ? modelCosmetics[model.id] : undefined
  const bgConfig = currentCosmetics?.background
  const bgStyle = bgConfig ? resolveBackground(bgConfig) : undefined
  const particlePresetId = currentCosmetics?.particleEffect ?? null
  const gridConfig = currentCosmetics?.grid



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

  // Effective camera scale = RMM zoom × free zoom
  const effectiveScale = frame.snapshot.cameraScale * frame.freeScale
  const effectiveScaleRef = useRef(effectiveScale)
  effectiveScaleRef.current = effectiveScale

  // Flow rotation ref — updated later by flowRotation state, used by sceneStyle
  const flowRotationRef = useRef(0)
  const [flowRotation, setFlowRotation] = useState(0)
  flowRotationRef.current = flowRotation

  // Dynamic grid extent — auto-expands/contracts in GRID_CHUNK increments based on node positions
  const gridExtent = useMemo(() => computeGridExtent(model?.nodes ?? []), [model?.nodes])

  const { sceneStyle, sceneTx, sceneTy, gridPxW, gridPxH } = useMemo(() => {
    // Auto-center: smoothly pan the scene so the selected node tracks toward viewport center.
    // At nodeProgress=0, no centering. At nodeProgress=1, node is centered.
    // centering = (vpCenter − node% × SCENE) × nodeProgress × scale
    let cx = 0
    let cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * effectiveScale
      cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * effectiveScale
    }
    const tx = cx + frame.panOffset.x
    const ty = cy + frame.panOffset.y
    const gridPxW = SCENE_W * gridSnap / 100
    const gridPxH = SCENE_H * gridSnap / 100
    const rot = flowRotationRef.current
    const rotateStr = rot !== 0 ? ` rotate(${rot}deg)` : ''
    return {
      sceneStyle: {
        width: SCENE_W,
        height: SCENE_H,
        transform: `translate(${tx}px, ${ty}px) scale(${effectiveScale})${rotateStr}`,
        transformOrigin: `${vpSize.w / 2}px ${vpSize.h / 2}px`,
      },
      sceneTx: tx,
      sceneTy: ty,
      gridPxW,
      gridPxH,
    }
  }, [selectedNode, frame.snapshot.nodeProgress, effectiveScale, frame.panOffset.x, frame.panOffset.y, vpSize.w, vpSize.h, gridSnap, flowRotation])

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
      const cs = effectiveScale
      const residual = {
        x: (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs,
        y: (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs,
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

  // ---- Selection rectangle (right-click drag) ----
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [selectionRect, setSelectionRect] = useState<{
    startX: number; startY: number; endX: number; endY: number
  } | null>(null)
  const selectionStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const justFinishedSelectionRef = useRef(false)
  const clipboardRef = useRef<{ nodes: ModelNode[]; connections: ModelConnection[] } | null>(null)

  // Clear multi-selection when model changes (e.g. MPD switch)
  useEffect(() => { setSelectedNodeIds(new Set()) }, [frame.modelId])

  // Reset free zoom when a node is selected (animated transition + pan toward node)
  useEffect(() => {
    if (!frame.selectedNodeId || frame.freeScale === 1) return
    const node = model?.nodes.find((n) => n.id === frame.selectedNodeId)
    if (!node) return
    const startScale = frame.freeScale
    const startPanX = frame.panOffset.x
    const startPanY = frame.panOffset.y
    const cs = frame.snapshot.cameraScale
    const targetPanX = (vpSize.w / 2 - node.x / 100 * SCENE_W) * cs
    const targetPanY = (vpSize.h / 2 - node.y / 100 * SCENE_H) * cs
    const duration = 300 // ms
    let t0: number | null = null
    let raf = 0
    const step = (ts: number) => {
      if (t0 === null) t0 = ts
      const elapsed = ts - t0
      const t = Math.min(elapsed / duration, 1)
      const eased = 1 - (1 - t) * (1 - t) // ease-out quad
      setFreeScale(startScale + (1 - startScale) * eased)
      setPanOffset(
        startPanX + (targetPanX - startPanX) * eased,
        startPanY + (targetPanY - startPanY) * eased,
      )
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [frame.selectedNodeId])

  // MPD curtain transition state
  const [mpdCurtain, setMpdCurtain] = useState<{
    oldModel: Model
    oldSceneStyle: React.CSSProperties
    oldBgStyle?: React.CSSProperties
    oldBgConfig?: BackgroundConfig
    particleScreenshot: string | null
    oldNodeSizes: Map<string, { w: number; h: number }>
    oldGridExtent: { minX: number; minY: number; maxX: number; maxY: number }
    oldGridBgImage: string
    oldGridPxW: number
    oldGridPxH: number
    progress: number
    direction: 'left' | 'right'
  } | null>(null)
  const curtainRaf = useRef<number>(0)
  const particleContainerRef = useRef<HTMLDivElement>(null)
  // Live scene node sizes — kept in sync for curtain snapshot
  const liveNodeSizesRef = useRef<Map<string, { w: number; h: number }>>(new Map())

  /** Convert a client (screen) position to scene-percentage coords */
  const clientToScene = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current
    if (!el) return { x: 50, y: 50 }
    const rect = el.getBoundingClientRect()
    // Account for scene transform: translate + scale
    const cs = effectiveScale
    let cx = 0, cy = 0
    if (selectedNode) {
      const np = frame.snapshot.nodeProgress
      cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs
      cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs
    }
    const ox = frame.panOffset.x + cx
    const oy = frame.panOffset.y + cy
    // Scene local pixel coords (rect.width/2 = viewport center = transform-origin)
    const localX = (clientX - rect.left - rect.width / 2 - ox) / cs + rect.width / 2
    const localY = (clientY - rect.top - rect.height / 2 - oy) / cs + rect.height / 2
    return {
      x: (localX / SCENE_W) * 100,
      y: (localY / SCENE_H) * 100,
    }
  }, [effectiveScale, frame.snapshot.nodeProgress, frame.panOffset.x, frame.panOffset.y, selectedNode, vpSize.w, vpSize.h])

  const handleNodeDragStart = useCallback((nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    // Locked nodes cannot be dragged
    const draggedNode = model.nodes.find((n) => n.id === nodeId)
    if (draggedNode?.locked) return
    draggingNodeRef.current = nodeId
    setDraggingNodeId(nodeId)
    beginMoveNode(frame.modelId)
    // Capture offsets for multi-drag when dragged node is in the selection
    multiDragOffsetsRef.current.clear()
    if (selectedNodeIds.has(nodeId)) {
      const pos = clientToScene(e.clientX, e.clientY)
      for (const id of selectedNodeIds) {
        const n = model.nodes.find((nd) => nd.id === id)
        if (n && id !== nodeId && !n.locked) {
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
  const [activeConnectionType, setActiveConnectionType] = useState<ConnectionType>('default')
  const [connectionDraft, setConnectionDraft] = useState<{
    fromId: string
    fromX: number
    fromY: number
    toX: number
    toY: number
    connectionType?: ConnectionType
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
      connectionType: activeConnectionType,
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
      addConnection(frame.modelId, { from: connectionDraft.fromId, to: target.id, type: activeConnectionType === 'default' ? undefined : activeConnectionType })
    }
    setConnectionDraft(null)
  }, [connectionDraft, clientToScene, model.nodes, frame.modelId, addConnection, activeConnectionType])

  // ---- Flow animation state ----
  const [flowAnimations, setFlowAnimations] = useState<Map<string, number>>(new Map()) // connectionKey → progress (0→1)
  const [emergeAnimations, setEmergeAnimations] = useState<Map<string, number>>(new Map()) // connectionKey → progress (0→1) for emerge scale-in
  const [flowActiveNodes, setFlowActiveNodes] = useState<Set<string>>(new Set()) // node IDs currently executing effects
  const flowAnimRef = useRef<number | null>(null)
  const flowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flowMediaDoneRef = useRef(new Set<string>()) // nodeIds whose media finished playing

  // ---- Flow recording state ----
  const [forceCollapseSidebars, setForceCollapseSidebars] = useState(false)
  const [hideToolbar, setHideToolbar] = useState(false)
  const flowRecorderRef = useRef<MediaRecorder | null>(null)
  const flowRecordChunksRef = useRef<BlobPart[]>([])
  const flowRecordStreamRef = useRef<MediaStream | null>(null)

  // ---- Flow effect editor state ----
  const [editingEffect, setEditingEffect] = useState<{ nodeId: string; effectId: string } | null>(null)

  type FlowTask =
    | { id: string; kind: 'node'; nodeId: string; durationMs: number; dependsOn: string[]; startTime: number }
    | { id: string; kind: 'wire'; connectionKey: string; durationMs: number; dependsOn: string[]; startTime: number }

  type FlowDAG = {
    tasks: Map<string, FlowTask>
    activeTasks: Set<string>
    completedTasks: Set<string>
    untrackedPaths: Set<string>
  }

  const flowDAGRef = useRef<FlowDAG | null>(null)

  // Camera tracking state for flow-follow
  const flowCameraRef = useRef<{
    preFlowPan: { x: number; y: number }
    preFlowScale: number
    lastTrackedCenter: { x: number; y: number } | null
    active: boolean
  } | null>(null)

  // Camera effect override (from 'camera' effect node)
  const flowCameraOverrideRef = useRef<{
    panX: number; panY: number; zoom: number; rotation: number
    durationMs: number; startTime: number
    panXDurationMs: number; panYDurationMs: number; zoomDurationMs: number; rotationDurationMs: number
    panXResetMode: string; panYResetMode: string; zoomResetMode: string; rotationResetMode: string
    panXEasing: string; panYEasing: string; zoomEasing: string; rotationEasing: string
    startPan: { x: number; y: number }; startFreeScale: number
  } | null>(null)
  // Smooth fadeout for residual camera effects when override expires
  const flowCameraFadeoutRef = useRef<{
    rotation: number; freeScaleOffset: number; startFreeScale: number
  } | null>(null)
  const [shakeOffset, setShakeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const brokenNodeElementsRef = useRef<HTMLElement[]>([])
  const emergeHiddenElementsRef = useRef<HTMLElement[]>([])
  const scaleRevertTimersRef = useRef<number[]>([])
  const flowColorBackupsRef = useRef<{ el: HTMLElement; bg: string }[]>([])

  const restoreBrokenNodes = useCallback(() => {
    for (const el of brokenNodeElementsRef.current) {
      el.style.opacity = ''
    }
    brokenNodeElementsRef.current = []
  }, [])

  const restoreEmergeNodes = useCallback(() => {
    for (const el of emergeHiddenElementsRef.current) {
      el.style.opacity = ''
      el.style.transform = 'translate(-50%, -50%)'
      el.style.transition = ''
    }
    emergeHiddenElementsRef.current = []
  }, [])

  const stopFlowAnimation = useCallback(() => {
    if (flowAnimRef.current != null) cancelAnimationFrame(flowAnimRef.current)
    if (flowTimeoutRef.current != null) clearTimeout(flowTimeoutRef.current)
    flowAnimRef.current = null
    flowTimeoutRef.current = null
    flowCameraOverrideRef.current = null
    flowCameraFadeoutRef.current = null
    // Animate camera back to pre-flow position
    const cam = flowCameraRef.current
    if (cam?.active) {
      const startPan = { x: panOffsetRef.current.x, y: panOffsetRef.current.y }
      const startScale = freeScaleRef.current
      const targetPan = cam.preFlowPan
      const targetScale = cam.preFlowScale
      const startTime = performance.now()
      const duration = 500
      const animateBack = (now: number) => {
        const t = Math.min((now - startTime) / duration, 1)
        const ease = 1 - (1 - t) * (1 - t) // ease-out quad
        setPanOffset(
          startPan.x + (targetPan.x - startPan.x) * ease,
          startPan.y + (targetPan.y - startPan.y) * ease,
        )
        setFreeScale(startScale + (targetScale - startScale) * ease)
        setFlowRotation(prev => prev * (1 - ease))
        if (t < 1) requestAnimationFrame(animateBack)
      }
      requestAnimationFrame(animateBack)
    } else {
      setFlowRotation(0)
    }
    flowCameraRef.current = null
    flowDAGRef.current = null
    flowMediaDoneRef.current.clear()
    setFlowAnimations(new Map())
    setEmergeAnimations(new Map())
    setFlowActiveNodes(new Set())
    restoreBrokenNodes()
    restoreEmergeNodes()
    for (const t of scaleRevertTimersRef.current) clearTimeout(t)
    scaleRevertTimersRef.current = []
    // Restore colors changed by permanent color effects
    for (const { el, bg } of flowColorBackupsRef.current) {
      el.style.transition = 'background 400ms ease'
      el.style.background = bg
      setTimeout(() => { el.style.transition = '' }, 400)
    }
    flowColorBackupsRef.current = []
    // Stop all playing media elements
    document.querySelectorAll('[data-node-id] video, [data-node-id] audio').forEach(el => {
      const media = el as HTMLVideoElement | HTMLAudioElement
      if (!media.paused) media.pause()
    })
    // Stop flow recording and download result
    if (flowRecorderRef.current && flowRecorderRef.current.state !== 'inactive') {
      flowRecorderRef.current.stop()
      // onstop handler will assemble blob, download, and restore UI
    } else {
      // Stop stream tracks if recording never started
      if (flowRecordStreamRef.current) {
        flowRecordStreamRef.current.getTracks().forEach(t => t.stop())
        flowRecordStreamRef.current = null
      }
      setForceCollapseSidebars(false)
      setHideToolbar(false)
      document.documentElement.style.cursor = ''
    }
  }, [setPanOffset, setFreeScale, restoreBrokenNodes, restoreEmergeNodes])

  // Trigger media playback on a node via DOM
  const triggerMediaPlay = useCallback((nodeId: string) => {
    const article = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
    if (!article) return
    const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
    if (media) {
      const node = model.nodes.find(n => n.id === nodeId)
      if (node?.playStart != null) media.currentTime = node.playStart
      media.play().catch(() => {})
    }
  }, [model.nodes])

  /**
   * Execute all effect graphs on a diagram node. Returns total duration (ms).
   * Traverses each effect's graph from the entry node, running effects in BFS
   * layers: nodes at the same depth run in parallel, layers run in sequence.
   */
  const executeNodeEffects = useCallback((nodeId: string): number => {
    const node = model.nodes.find(n => n.id === nodeId)
    if (!node) return 100

    // Collect all effects — include the implicit locked media effect if present
    const effects = node.flowEffects ?? []
    // Also consider implicit media if no locked effect exists
    const hasLockedEffect = effects.some(e => e.locked)
    const hasMedia = !!node.mediaType

    let maxDuration = 0

    for (const effect of effects) {
      const graphNodes = effect.graph.nodes
      const graphEdges = effect.graph.edges
      if (graphNodes.length === 0) continue

      // Build adjacency from graph edges
      const adj = new Map<string, string[]>()
      for (const e of graphEdges) {
        if (!adj.has(e.from)) adj.set(e.from, [])
        adj.get(e.from)!.push(e.to)
      }

      // BFS from entry node(s), executing effects layer by layer
      const entryNodes = graphNodes.filter(n => n.kind === 'entry')
      if (entryNodes.length === 0) continue

      let frontier = entryNodes.map(n => n.id)
      const visited = new Set<string>(frontier)
      let totalDelay = 0

      while (frontier.length > 0) {
        const nextFrontier: string[] = []
        let layerMaxDuration = 0

        for (const gNodeId of frontier) {
          const targets = adj.get(gNodeId) ?? []
          for (const targetId of targets) {
            if (visited.has(targetId)) continue
            visited.add(targetId)
            nextFrontier.push(targetId)

            const gNode = graphNodes.find(n => n.id === targetId)
            if (!gNode) continue

            // Schedule this effect's execution
            const delay = totalDelay
            const dur = (gNode.config.durationMs as number) ?? 300

            // ╔══════════════════════════════════════════════════════════════╗
            // ║  IMPORTANT: Nodes use `transform: translate(-50%, -50%)`     ║
            // ║  for centering. Any effect that modifies `el.style.transform`║
            // ║  MUST preserve this, e.g.:                                   ║
            // ║    During:  translate(calc(-50% + Xpx), calc(-50% + Ypx))    ║
            // ║    Cleanup: translate(-50%, -50%)                            ║
            // ║  Setting transform to '' causes SE displacement.             ║
            // ╚══════════════════════════════════════════════════════════════╝

            switch (gNode.kind) {
              case 'play-media': {
                const isReactive = !!gNode.config.audioReactive
                const reactiveEffect = (gNode.config.visualEffect as string) ?? 'glow-pulse'
                const reactiveIntensity = (gNode.config.reactiveIntensity as number) ?? 1
                const capturedNodeId = nodeId
                setTimeout(() => {
                  triggerMediaPlay(capturedNodeId)
                  // Listen for media completion to signal the flow DAG
                  const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
                  if (!article) return
                  const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
                  if (media) {
                    const onMediaDone = () => {
                      flowMediaDoneRef.current.add(capturedNodeId)
                      media.removeEventListener('pause', onMediaDone)
                      media.removeEventListener('ended', onMediaDone)
                    }
                    // Wait for playback to actually start before listening for pause/ended
                    const onPlaying = () => {
                      media.removeEventListener('playing', onPlaying)
                      media.addEventListener('pause', onMediaDone)
                      media.addEventListener('ended', onMediaDone)
                    }
                    media.addEventListener('playing', onPlaying)
                  } else {
                    // GIF or image node: no media element, signal completion immediately
                    flowMediaDoneRef.current.add(capturedNodeId)
                  }
                  if (isReactive) {
                    // Start audio-reactive visualization after a short delay for media to begin
                    setTimeout(() => {
                      const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
                      if (!article) return
                      const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
                      if (!media) return

                      let cached = audioCtxCache.get(media)
                      if (!cached) {
                        try {
                          const audioCtx = new AudioContext()
                          const analyser = audioCtx.createAnalyser()
                          analyser.fftSize = 256
                          const source = audioCtx.createMediaElementSource(media)
                          source.connect(analyser)
                          analyser.connect(audioCtx.destination)
                          cached = { ctx: audioCtx, analyser }
                          audioCtxCache.set(media, cached)
                        } catch {
                          return
                        }
                      }
                      // Resume context if it was suspended (e.g. browser autoplay policy)
                      if (cached.ctx.state === 'suspended') cached.ctx.resume()

                      const { analyser } = cached
                      const dataArray = new Uint8Array(analyser.frequencyBinCount)
                      const origFilter = article.style.filter
                      const origOpacity = article.style.opacity
                      const origTransform = article.style.transform

                      const arTick = () => {
                        // Stop when media is paused or ended
                        if (media.paused || media.ended) {
                          article.style.filter = origFilter
                          article.style.opacity = origOpacity
                          article.style.transform = origTransform
                          return
                        }

                        analyser.getByteFrequencyData(dataArray)
                        let sum = 0
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
                        const amp = (sum / dataArray.length / 255) * reactiveIntensity

                        switch (reactiveEffect) {
                          case 'glow-pulse': {
                            const glow = Math.round(amp * 30)
                            article.style.filter = `drop-shadow(0 0 ${glow}px rgba(56, 189, 248, ${amp}))`
                            break
                          }
                          case 'scale-bounce': {
                            const scaleVal = 1 + amp * 0.15
                            article.style.transform = origTransform.replace(/scale\([^)]*\)/, '').trim() + ` scale(${scaleVal})`
                            break
                          }
                          case 'opacity-pulse': {
                            const op = 0.4 + amp * 0.6
                            article.style.opacity = `${op}`
                            break
                          }
                          case 'color-shift': {
                            const hue = Math.round(amp * 360)
                            article.style.filter = `hue-rotate(${hue}deg) saturate(${1 + amp})`
                            break
                          }
                        }
                        requestAnimationFrame(arTick)
                      }
                      requestAnimationFrame(arTick)
                    }, 100)
                  }
                }, delay)
                // Use large cap duration; actual completion signalled by media pause/ended event
                layerMaxDuration = Math.max(layerMaxDuration, 600000)
                break
              }
              case 'wait':
                layerMaxDuration = Math.max(layerMaxDuration, dur)
                break
              case 'color': {
                const color = (gNode.config.color as string) ?? '#f59e0b'
                const permanent = !!gNode.config.permanent
                setTimeout(() => {
                  const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
                  if (el) {
                    flowColorBackupsRef.current.push({ el, bg: el.style.background })
                    el.style.transition = `background ${dur}ms ease`
                    el.style.background = color
                    if (!permanent) {
                      setTimeout(() => {
                        el.style.background = ''
                        el.style.transition = ''
                      }, dur)
                    }
                  }
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, dur)
                break
              }
              case 'move': {
                const waypoints = (gNode.config.waypoints as Array<{dx: number; dy: number; durationMs: number}>) ?? []
                const roundtrip = !!gNode.config.roundtrip
                // Compute total duration across all waypoints
                let totalWpDur = 0
                for (const wp of waypoints) totalWpDur += (wp.durationMs ?? 500)
                if (roundtrip) totalWpDur += (waypoints.length > 0 ? (waypoints[waypoints.length - 1].durationMs ?? 500) : 500)
                setTimeout(() => {
                  if (!node) return
                  let wpDelay = 0
                  let cumDx = 0
                  let cumDy = 0
                  for (const wp of waypoints) {
                    const wpDur = wp.durationMs ?? 500
                    const dx = wp.dx ?? 0
                    const dy = wp.dy ?? 0
                    cumDx += dx
                    cumDy += dy
                    const targetX = node.x + cumDx
                    const targetY = node.y + cumDy
                    setTimeout(() => {
                      updateNodeProps(frame.modelId, nodeId, { x: targetX, y: targetY })
                    }, wpDelay)
                    wpDelay += wpDur
                  }
                  if (roundtrip) {
                    // Return directly to the original position
                    const lastWpDur = waypoints.length > 0 ? (waypoints[waypoints.length - 1].durationMs ?? 500) : 500
                    setTimeout(() => {
                      updateNodeProps(frame.modelId, nodeId, { x: node.x, y: node.y })
                    }, wpDelay)
                    wpDelay += lastWpDur
                  }
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, totalWpDur)
                break
              }
              case 'spawn': {
                const spawnItems = (gNode.config.spawnItems as Array<{
                  label: string; offsetX: number; offsetY: number;
                  animation: string; connectionType: string
                }>) ?? []
                setTimeout(() => {
                  if (!node) return
                  for (const item of spawnItems) {
                    const newId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                    const spawnX = node.x + item.offsetX
                    const spawnY = node.y + item.offsetY
                    addNode(frame.modelId, { id: newId, label: item.label, x: spawnX, y: spawnY })
                    if (item.connectionType !== 'none') {
                      addConnection(frame.modelId, {
                        from: nodeId, to: newId,
                        type: item.connectionType === 'flow' ? 'flow' : 'default',
                      })
                    }
                    // Spawn animation on the DOM element
                    requestAnimationFrame(() => {
                      const el = document.querySelector(`[data-node-id="${CSS.escape(newId)}"]`) as HTMLElement | null
                      if (el) {
                        if (item.animation === 'zip-in') {
                          el.style.opacity = '0'
                          el.style.transform = 'scale(0.3)'
                          el.style.transition = 'opacity 300ms ease, transform 300ms ease'
                          requestAnimationFrame(() => {
                            el.style.opacity = '1'
                            el.style.transform = 'scale(1)'
                          })
                        } else {
                          // emerge: scale from 0 at source, then move to position
                          el.style.transform = 'scale(0)'
                          el.style.transition = 'transform 400ms ease'
                          requestAnimationFrame(() => {
                            el.style.transform = 'scale(1)'
                          })
                        }
                      }
                    })
                  }
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, 400)
                break
              }
              case 'handoff-rmm': {
                setTimeout(() => {
                  if (!node?.childModelId) {
                    console.warn('[Flow] Handoff to RMM: node has no childModelId')
                    return
                  }
                  // Select the node so zoomIn() targets it, then animate zoom
                  selectNode(nodeId)
                  const targetChildModelId = node.childModelId
                  const zoomInterval = setInterval(() => {
                    const curFrame = currentFrame()
                    // Once we've pushed into the child model, stop zooming and trigger child effects
                    if (curFrame.modelId === targetChildModelId) {
                      clearInterval(zoomInterval)
                      // Read fresh model data from the store (not the stale closure)
                      const freshModels = useHybridZoomStore.getState().models
                      const childModel = freshModels[targetChildModelId]
                      if (childModel) {
                        for (const childNode of childModel.nodes) {
                          const effects = childNode.flowEffects ?? []
                          for (const fx of effects) {
                            const rmmEntry = fx.graph.nodes.find(
                              gn => gn.kind === 'entry' && gn.config.triggeredByRmmParent
                            )
                            if (rmmEntry) {
                              // Delay to let the freshly-rendered child model settle,
                              // then call via ref to get the latest startFlowAnimation (which now sees child model)
                              setTimeout(() => {
                                startFlowAnimationRef.current(childNode.id)
                              }, 300)
                              return
                            }
                          }
                        }
                        console.warn('[Flow] Handoff to RMM: no entry with "Triggered by RMM Parent" found in child model')
                      }
                      return
                    }
                    zoomIn()
                  }, 50)
                  // Safety: clear after 5s in case something goes wrong
                  setTimeout(() => clearInterval(zoomInterval), 5000)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, 1200)
                break
              }
              case 'return-rmm': {
                setTimeout(() => {
                  if (stack.length <= 1) {
                    console.warn('[Flow] Return from RMM: already at root level')
                    return
                  }
                  const parentModelId = stack[stack.length - 2].modelId
                  const zoomInterval = setInterval(() => {
                    const freshState = useHybridZoomStore.getState()
                    const curFrame = freshState.stack[freshState.stack.length - 1]
                    // Keep zooming out until we're back in the parent AND progress is at 0
                    if (curFrame.modelId === parentModelId && curFrame.snapshot.progress <= 0) {
                      clearInterval(zoomInterval)
                      return
                    }
                    zoomOut()
                  }, 50)
                  // Safety: clear after 5s
                  setTimeout(() => clearInterval(zoomInterval), 5000)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, 1200)
                break
              }
              case 'handoff-mpd': {
                const targetMpdId = (gNode.config.targetMpdId as string) ?? ''
                setTimeout(() => {
                  if (!targetMpdId) {
                    console.warn('[Flow] Handoff to MPD: no target MPD selected')
                    return
                  }
                  if (node?.mpdIds && node.mpdIds.length > 1) {
                    switchNodeMpd(targetMpdId, node.mpdIds)
                  } else {
                    switchFrameMpd(targetMpdId)
                  }
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, 400)
                break
              }
              case 'entry':
                break
              case 'camera': {
                const panX = (gNode.config.panX as number) ?? 0
                const panY = (gNode.config.panY as number) ?? 0
                const zoom = (gNode.config.zoom as number) ?? 1
                const rotation = (gNode.config.rotation as number) ?? 0
                const camDur = (gNode.config.durationMs as number) ?? 1000
                const panXDurationMs = (gNode.config.panXDurationMs as number) ?? 1000
                const panYDurationMs = (gNode.config.panYDurationMs as number) ?? 1000
                const zoomDurationMs = (gNode.config.zoomDurationMs as number) ?? 1000
                const rotationDurationMs = (gNode.config.rotationDurationMs as number) ?? 1000
                const panXResetMode = (gNode.config.panXResetMode as string) ?? 'attr'
                const panYResetMode = (gNode.config.panYResetMode as string) ?? 'attr'
                const zoomResetMode = (gNode.config.zoomResetMode as string) ?? 'attr'
                const rotationResetMode = (gNode.config.rotationResetMode as string) ?? 'attr'
                const panXEasing = (gNode.config.panXEasing as string) ?? 'ease-out'
                const panYEasing = (gNode.config.panYEasing as string) ?? 'ease-out'
                const zoomEasing = (gNode.config.zoomEasing as string) ?? 'ease-out'
                const rotationEasing = (gNode.config.rotationEasing as string) ?? 'ease-out'
                setTimeout(() => {
                  // Clear any active fadeout from a previous camera node
                  flowCameraFadeoutRef.current = null
                  flowCameraOverrideRef.current = {
                    panX, panY, zoom, rotation,
                    durationMs: camDur,
                    panXDurationMs, panYDurationMs, zoomDurationMs, rotationDurationMs,
                    panXResetMode, panYResetMode, zoomResetMode, rotationResetMode,
                    panXEasing, panYEasing, zoomEasing, rotationEasing,
                    startTime: performance.now(),
                    startPan: { x: panOffsetRef.current.x, y: panOffsetRef.current.y },
                    startFreeScale: freeScaleRef.current,
                  }
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, camDur)
                break
              }
              case 'break': {
                const axis = (gNode.config.axis as string) ?? 'horizontal'
                const shakeIntensity = (gNode.config.shakeIntensity as number) ?? 8
                const shakeDurationMs = (gNode.config.shakeDurationMs as number) ?? 300
                const fallDurationMs = (gNode.config.fallDurationMs as number) ?? 600
                const totalBreakDur = Math.max(shakeDurationMs, fallDurationMs)
                setTimeout(() => {
                  const article = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
                  if (!article) return

                  // Clone the node and create two halves
                  const rect = article.getBoundingClientRect()
                  const clone1 = article.cloneNode(true) as HTMLElement
                  const clone2 = article.cloneNode(true) as HTMLElement

                  // Position clones absolutely in the viewport
                  for (const clone of [clone1, clone2]) {
                    clone.style.position = 'fixed'
                    clone.style.left = `${rect.left}px`
                    clone.style.top = `${rect.top}px`
                    clone.style.width = `${rect.width}px`
                    clone.style.height = `${rect.height}px`
                    clone.style.zIndex = '10000'
                    clone.style.pointerEvents = 'none'
                    clone.style.transition = 'none'
                    clone.style.animation = 'none'
                    clone.style.boxShadow = 'none'
                    clone.style.filter = 'none'
                    clone.classList.remove('focused', 'flow-active', 'multi-selected')
                    clone.removeAttribute('data-node-id')
                  }

                  if (axis === 'vertical') {
                    // Left half / right half
                    clone1.style.clipPath = 'inset(0 50% 0 0)'
                    clone2.style.clipPath = 'inset(0 0 0 50%)'
                  } else {
                    // Top half / bottom half
                    clone1.style.clipPath = 'inset(0 0 50% 0)'
                    clone2.style.clipPath = 'inset(50% 0 0 0)'
                  }

                  document.body.appendChild(clone1)
                  document.body.appendChild(clone2)

                  // Hide original and track it for restoration
                  article.style.opacity = '0'
                  brokenNodeElementsRef.current.push(article)

                  // Animate fall + fade
                  const fallStart = performance.now()
                  const animateFall = (now: number) => {
                    const t = Math.min((now - fallStart) / fallDurationMs, 1)
                    const ease = t * t // ease-in (gravity)
                    const fadeOut = Math.max(0, 1 - t * 1.5)

                    if (axis === 'vertical') {
                      // Left half goes left
                      clone1.style.transform = `translate(${-80 * ease}px, ${20 * ease}px) rotate(${-15 * ease}deg)`
                      clone1.style.opacity = `${fadeOut}`
                      // Right half goes right
                      clone2.style.transform = `translate(${80 * ease}px, ${20 * ease}px) rotate(${15 * ease}deg)`
                      clone2.style.opacity = `${fadeOut}`
                    } else {
                      // Top half moves up and left
                      clone1.style.transform = `translate(${-20 * ease}px, ${-80 * ease}px) rotate(${-15 * ease}deg)`
                      clone1.style.opacity = `${fadeOut}`
                      // Bottom half falls down and right
                      clone2.style.transform = `translate(${20 * ease}px, ${120 * ease}px) rotate(${10 * ease}deg)`
                      clone2.style.opacity = `${fadeOut}`
                    }

                    if (t < 1) {
                      requestAnimationFrame(animateFall)
                    } else {
                      clone1.remove()
                      clone2.remove()
                    }
                  }
                  requestAnimationFrame(animateFall)

                  // Screen shake
                  const shakeStart = performance.now()
                  const animateShake = (now: number) => {
                    const t = Math.min((now - shakeStart) / shakeDurationMs, 1)
                    if (t < 1) {
                      const decay = 1 - t
                      setShakeOffset({
                        x: (Math.random() * 2 - 1) * shakeIntensity * decay,
                        y: (Math.random() * 2 - 1) * shakeIntensity * decay,
                      })
                      requestAnimationFrame(animateShake)
                    } else {
                      setShakeOffset({ x: 0, y: 0 })
                    }
                  }
                  requestAnimationFrame(animateShake)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, totalBreakDur)
                break
              }
              case 'expand': {
                const dur = (gNode.config.durationMs as number) ?? 300
                setTimeout(() => {
                  const nd = model.nodes.find(n => n.id === nodeId)
                  const expandedH = Math.max(nd?.nodeHeight ?? 60, 160)
                  updateNodeProps(frame.modelId, nodeId, { contentCollapsed: false, nodeHeight: expandedH })
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, dur)
                break
              }
              case 'collapse': {
                const dur = (gNode.config.durationMs as number) ?? 300
                setTimeout(() => {
                  updateNodeProps(frame.modelId, nodeId, { contentCollapsed: true, nodeHeight: 60 })
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, dur)
                break
              }
              case 'jitter': {
                const intensity = (gNode.config.intensity as number) ?? 4
                const durationMs = (gNode.config.durationMs as number) ?? 1000
                setTimeout(() => {
                  const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
                  if (!el) return
                  const start = performance.now()
                  const animateJitter = (now: number) => {
                    const t = (now - start) / durationMs
                    if (t >= 1) {
                      el.style.transform = 'translate(-50%, -50%)'
                      return
                    }
                    const decay = 1 - t
                    const dx = (Math.random() * 2 - 1) * intensity * decay
                    const dy = (Math.random() * 2 - 1) * intensity * decay
                    el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
                    requestAnimationFrame(animateJitter)
                  }
                  requestAnimationFrame(animateJitter)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, durationMs)
                break
              }
              case 'float': {
                const amplitude = (gNode.config.amplitude as number) ?? 6
                const speed = (gNode.config.speed as number) ?? 1
                const durationMs = (gNode.config.durationMs as number) ?? 3000
                setTimeout(() => {
                  const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
                  if (!el) return
                  // Random phase offsets so multi-axis wobble looks organic
                  const phaseX = Math.random() * Math.PI * 2
                  const phaseY = Math.random() * Math.PI * 2
                  const start = performance.now()
                  const animateFloat = (now: number) => {
                    const t = (now - start) / durationMs
                    if (t >= 1) {
                      el.style.transform = 'translate(-50%, -50%)'
                      return
                    }
                    // Wobble using two incommensurate sine waves per axis
                    const s = t * speed * Math.PI * 2 * (durationMs / 1000)
                    const dx = Math.sin(s * 1.3 + phaseX) * amplitude * 0.7 + Math.sin(s * 2.1 + phaseX + 1) * amplitude * 0.3
                    const dy = Math.sin(s * 0.9 + phaseY) * amplitude * 0.7 + Math.cos(s * 1.7 + phaseY + 2) * amplitude * 0.3
                    el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
                    requestAnimationFrame(animateFloat)
                  }
                  requestAnimationFrame(animateFloat)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, durationMs)
                break
              }
              case 'spawn-circular': {
                const scItems = (gNode.config.spawnCircularItems as Array<{
                  label: string; animation: string; connectionType: string
                }>) ?? []
                const distance = (gNode.config.distance as number) ?? 120
                const delayBetweenMs = (gNode.config.delayBetweenMs as number) ?? 200
                const count = scItems.length
                const totalSpawnDur = count > 0 ? (count - 1) * delayBetweenMs + 400 : 0
                setTimeout(() => {
                  if (!node || count === 0) return
                  scItems.forEach((item, idx) => {
                    setTimeout(() => {
                      const angle = (2 * Math.PI * idx) / count - Math.PI / 2 // start from top
                      const spawnX = node.x + Math.cos(angle) * distance
                      const spawnY = node.y + Math.sin(angle) * distance
                      const newId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                      addNode(frame.modelId, { id: newId, label: item.label, x: spawnX, y: spawnY })
                      if (item.connectionType !== 'none') {
                        addConnection(frame.modelId, {
                          from: nodeId, to: newId,
                          type: item.connectionType === 'flow' ? 'flow' : 'default',
                        })
                      }
                      requestAnimationFrame(() => {
                        const el = document.querySelector(`[data-node-id="${CSS.escape(newId)}"]`) as HTMLElement | null
                        if (el) {
                          if (item.animation === 'zip-in') {
                            el.style.opacity = '0'
                            el.style.transform = 'scale(0.3)'
                            el.style.transition = 'opacity 300ms ease, transform 300ms ease'
                            requestAnimationFrame(() => {
                              el.style.opacity = '1'
                              el.style.transform = 'scale(1)'
                            })
                          } else {
                            el.style.transform = 'scale(0)'
                            el.style.transition = 'transform 400ms ease'
                            requestAnimationFrame(() => {
                              el.style.transform = 'scale(1)'
                            })
                          }
                        }
                      })
                    }, idx * delayBetweenMs)
                  })
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, totalSpawnDur)
                break
              }
              case 'emerge': {
                const animation = (gNode.config.animation as string) ?? 'scale-in'
                const emergeDur = (gNode.config.durationMs as number) ?? 600
                setTimeout(() => {
                  const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
                  if (!el) return

                  // Find the parent node via incoming flow connections
                  const incomingConn = model.connections.find(c => c.to === nodeId && c.type === 'flow')
                  const parentEl = incomingConn
                    ? document.querySelector(`[data-node-id="${CSS.escape(incomingConn.from)}"]`) as HTMLElement | null
                    : null
                  const connKey = incomingConn ? `${incomingConn.from}->${nodeId}` : ''

                  if (animation === 'fade-in') {
                    el.style.opacity = '0'
                    el.style.transition = `opacity ${emergeDur}ms ease`
                    // Also animate the connection during fade-in
                    const fadeStart = performance.now()
                    const animateFadeConn = (now: number) => {
                      const t = Math.min((now - fadeStart) / emergeDur, 1)
                      if (connKey) {
                        setEmergeAnimations(prev => {
                          const next = new Map(prev)
                          if (t >= 1) next.delete(connKey)
                          else next.set(connKey, t)
                          return next
                        })
                      }
                      if (t < 1) requestAnimationFrame(animateFadeConn)
                    }
                    requestAnimationFrame(() => {
                      el.style.opacity = '1'
                      requestAnimationFrame(animateFadeConn)
                      setTimeout(() => {
                        el.style.transition = ''
                      }, emergeDur)
                    })
                  } else if (parentEl) {
                    // scale-in: rAF-driven, animating both node transform and real connection
                    const parentRect = parentEl.getBoundingClientRect()
                    const selfRect = el.getBoundingClientRect()
                    const dx = parentRect.left + parentRect.width / 2 - (selfRect.left + selfRect.width / 2)
                    const dy = parentRect.top + parentRect.height / 2 - (selfRect.top + selfRect.height / 2)

                    el.style.opacity = '1'
                    el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`
                    el.style.transition = 'none'

                    const startTime = performance.now()
                    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
                    const animateEmerge = (now: number) => {
                      const raw = Math.min((now - startTime) / emergeDur, 1)
                      const t = easeOutCubic(raw)

                      // Interpolate node position and scale
                      const currDx = dx * (1 - t)
                      const currDy = dy * (1 - t)
                      el.style.transform = `translate(calc(-50% + ${currDx}px), calc(-50% + ${currDy}px)) scale(${t})`

                      // Drive the real connection via emergeAnimations state
                      if (connKey) {
                        setEmergeAnimations(prev => {
                          const next = new Map(prev)
                          if (raw >= 1) next.delete(connKey)
                          else next.set(connKey, t)
                          return next
                        })
                      }

                      if (raw < 1) {
                        requestAnimationFrame(animateEmerge)
                      } else {
                        el.style.transform = 'translate(-50%, -50%)'
                      }
                    }
                    requestAnimationFrame(animateEmerge)
                  } else {
                    // No parent — just scale in from self center
                    el.style.opacity = '1'
                    el.style.transform = 'translate(-50%, -50%) scale(0)'
                    el.style.transition = `transform ${emergeDur}ms ease`
                    requestAnimationFrame(() => {
                      el.style.transform = 'translate(-50%, -50%) scale(1)'
                      setTimeout(() => {
                        el.style.transition = ''
                        el.style.transform = 'translate(-50%, -50%)'
                      }, emergeDur)
                    })
                  }
                  // Remove from hidden list since it's now visible
                  emergeHiddenElementsRef.current = emergeHiddenElementsRef.current.filter(e => e !== el)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, emergeDur)
                break
              }
              case 'scale': {
                const targetWidth = (gNode.config.targetWidth as number) ?? 200
                const targetHeight = (gNode.config.targetHeight as number) ?? 120
                const scaleDur = (gNode.config.durationMs as number) ?? 500
                const persistent = gNode.config.persistent === true
                setTimeout(() => {
                  if (!node) return
                  const startW = node.nodeWidth ?? 160
                  const startH = node.nodeHeight ?? 60
                  // Target the outer wrapper div (parent of the article) which has position styles
                  const article = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
                  if (!article) return
                  // The wrapper is the article's parent if it's a polygon shape, otherwise the article itself
                  const el = (article.parentElement?.style.position === 'absolute' || article.parentElement?.style.position === 'fixed')
                    ? article.parentElement : article
                  const start = performance.now()
                  const animateScale = (now: number) => {
                    const t = Math.min((now - start) / scaleDur, 1)
                    const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
                    const w = startW + (targetWidth - startW) * ease
                    const h = startH + (targetHeight - startH) * ease
                    el.style.width = `${w}px`
                    el.style.minWidth = `${w}px`
                    el.style.height = `${h}px`
                    el.style.minHeight = `${h}px`
                    if (t < 1) {
                      requestAnimationFrame(animateScale)
                    } else if (persistent) {
                      el.style.width = ''
                      el.style.minWidth = ''
                      el.style.height = ''
                      el.style.minHeight = ''
                      updateNodeProps(frame.modelId, nodeId, { nodeWidth: targetWidth, nodeHeight: targetHeight })
                    } else {
                      // Hold at target size, then revert when flow stops
                      // (stopFlowAnimation will clear scaleRevertTimersRef)
                      // Animate back to original
                      const revertStart = performance.now()
                      const animateRevert = (now2: number) => {
                        const t2 = Math.min((now2 - revertStart) / scaleDur, 1)
                        const ease2 = t2 < 0.5 ? 2 * t2 * t2 : 1 - (-2 * t2 + 2) ** 2 / 2
                        const w2 = targetWidth + (startW - targetWidth) * ease2
                        const h2 = targetHeight + (startH - targetHeight) * ease2
                        el.style.width = `${w2}px`
                        el.style.minWidth = `${w2}px`
                        el.style.height = `${h2}px`
                        el.style.minHeight = `${h2}px`
                        if (t2 < 1) {
                          requestAnimationFrame(animateRevert)
                        } else {
                          el.style.width = ''
                          el.style.minWidth = ''
                          el.style.height = ''
                          el.style.minHeight = ''
                        }
                      }
                      // Delay the revert by a brief hold period
                      const timer = window.setTimeout(() => {
                        requestAnimationFrame(animateRevert)
                      }, 200)
                      scaleRevertTimersRef.current.push(timer)
                    }
                  }
                  requestAnimationFrame(animateScale)
                }, delay)
                layerMaxDuration = Math.max(layerMaxDuration, persistent ? scaleDur : scaleDur * 2 + 200)
                break
              }
              case 'record': {
                const captureMode = (gNode.config.captureMode as string) ?? 'tab'
                const hideCursor = gNode.config.hideCursor !== false
                const recWidth = (gNode.config.recordingWidth as number) || undefined
                const recHeight = (gNode.config.recordingHeight as number) || undefined
                const videoBitrateMbps = (gNode.config.videoBitrateMbps as number) || 32
                const codecPref = (gNode.config.codec as string) ?? 'vp9'
                const mimeTypes: Record<string, string[]> = {
                  vp9: ['video/webm;codecs=vp09.00.10.08', 'video/webm;codecs=vp9', 'video/webm'],
                  vp8: ['video/webm;codecs=vp8', 'video/webm'],
                  h264: ['video/mp4;codecs=avc1.640034', 'video/webm;codecs=h264', 'video/webm'],
                }
                const chosenMime = (mimeTypes[codecPref] ?? mimeTypes.vp9).find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
                const capturedNodeId = nodeId
                // Collapse sidebars and hide toolbar before recording starts
                setForceCollapseSidebars(true)
                setHideToolbar(true)
                if (hideCursor) document.documentElement.style.cursor = 'none'
                setTimeout(async () => {
                  try {
                    const stream = await navigator.mediaDevices.getDisplayMedia({
                      video: {
                        width: { ideal: recWidth },
                        height: { ideal: recHeight },
                      },
                      audio: true,
                      // @ts-expect-error -- preferCurrentTab is a newer Chrome API
                      preferCurrentTab: true,
                      selfBrowserSurface: 'include',
                    })

                    // Viewport-only: try CropTarget (Chrome 104+)
                    if (captureMode === 'viewport' && viewportRef.current) {
                      try {
                        // @ts-expect-error -- CropTarget is not yet in TS typings
                        if (typeof CropTarget !== 'undefined') {
                          // @ts-expect-error -- CropTarget.fromElement
                          const cropTarget = await CropTarget.fromElement(viewportRef.current)
                          const videoTrack = stream.getVideoTracks()[0]
                          // @ts-expect-error -- cropTo is newer Chrome API
                          if (videoTrack?.cropTo) await videoTrack.cropTo(cropTarget)
                        }
                      } catch {
                        // Fallback: full tab capture
                      }
                    }

                    flowRecordStreamRef.current = stream
                    flowRecordChunksRef.current = []
                    const recorder = new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: videoBitrateMbps * 1_000_000 })
                    recorder.ondataavailable = (e) => {
                      if (e.data.size > 0) flowRecordChunksRef.current.push(e.data)
                    }
                    recorder.onstop = () => {
                      // Stop stream tracks
                      stream.getTracks().forEach(t => t.stop())
                      flowRecordStreamRef.current = null
                      // Restore UI — expand sidebars, show toolbar, restore cursor
                      document.documentElement.style.cursor = ''
                      setForceCollapseSidebars(false)
                      setHideToolbar(false)
                      // Download recording — deferred so UI restores first
                      const chunks = flowRecordChunksRef.current
                      flowRecordChunksRef.current = []
                      flowRecorderRef.current = null
                      setTimeout(() => {
                        const isMp4 = chosenMime.startsWith('video/mp4')
                        const blob = new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' })
                        if (blob.size > 0) {
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `unigram-recording-${Date.now()}.${isMp4 ? 'mp4' : 'webm'}`
                          a.click()
                          URL.revokeObjectURL(url)
                        }
                      }, 100)
                    }
                    // Also handle user closing the browser share dialog
                    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                      if (recorder.state !== 'inactive') recorder.stop()
                    })
                    flowRecorderRef.current = recorder
                    recorder.start()
                    // Signal that recording is ready — flow can proceed
                    flowMediaDoneRef.current.add(capturedNodeId)
                  } catch {
                    // User cancelled the getDisplayMedia prompt
                    document.documentElement.style.cursor = ''
                    setForceCollapseSidebars(false)
                    setHideToolbar(false)
                    // Signal done so flow doesn't hang
                    flowMediaDoneRef.current.add(capturedNodeId)
                  }
                }, delay + 400) // 400ms extra to let sidebars animate closed
                // Use large cap; actual completion signalled by flowMediaDoneRef
                layerMaxDuration = Math.max(layerMaxDuration, 600000)
                break
              }
            }
          }
        }

        totalDelay += layerMaxDuration
        frontier = nextFrontier
      }

      maxDuration = Math.max(maxDuration, totalDelay)
    }

    // If there's implicit media and no locked effect, still play media
    if (hasMedia && !hasLockedEffect && effects.length === 0) {
      const capturedNodeId = nodeId
      triggerMediaPlay(capturedNodeId)
      // Set up flowMediaDoneRef listener so the flow blocks until media finishes
      const article = document.querySelector(`[data-node-id="${CSS.escape(capturedNodeId)}"]`) as HTMLElement | null
      if (article) {
        const media = article.querySelector('video, audio') as HTMLVideoElement | HTMLAudioElement | null
        if (media) {
          const onMediaDone = () => {
            flowMediaDoneRef.current.add(capturedNodeId)
            media.removeEventListener('pause', onMediaDone)
            media.removeEventListener('ended', onMediaDone)
          }
          const onPlaying = () => {
            media.removeEventListener('playing', onPlaying)
            media.addEventListener('pause', onMediaDone)
            media.addEventListener('ended', onMediaDone)
          }
          media.addEventListener('playing', onPlaying)
          maxDuration = Math.max(maxDuration, 600000)
        } else {
          // GIF/image: no media element, complete immediately
          flowMediaDoneRef.current.add(capturedNodeId)
          maxDuration = Math.max(maxDuration, 200)
        }
      } else {
        maxDuration = Math.max(maxDuration, 200)
      }
    }

    return maxDuration > 0 ? maxDuration : 100
  }, [model.nodes, triggerMediaPlay, frame.modelId, updateNodeProps, addNode, addConnection, pushModel, storeModels, stack, zoomIn, zoomOut, selectNode, currentFrame, switchNodeMpd, switchFrameMpd])

  // Keep a ref to the latest executeNodeEffects so async callbacks (e.g. RMM handoff)
  // can call the current version after a model change triggers a re-render.
  const executeNodeEffectsRef = useRef(executeNodeEffects)
  executeNodeEffectsRef.current = executeNodeEffects

  const startFlowAnimation = useCallback((startNodeId: string) => {
    stopFlowAnimation()
    // Build DAG from flow connections
    const flowConns = model.connections.filter(c => c.type === 'flow')
    if (flowConns.length === 0) return

    // Build adjacency (outgoing) and incoming maps
    const outgoing = new Map<string, ModelConnection[]>()
    const incoming = new Map<string, ModelConnection[]>()
    for (const c of flowConns) {
      if (!outgoing.has(c.from)) outgoing.set(c.from, [])
      outgoing.get(c.from)!.push(c)
      if (!incoming.has(c.to)) incoming.set(c.to, [])
      incoming.get(c.to)!.push(c)
    }

    // BFS to discover all reachable nodes
    const reachableNodes = new Set<string>([startNodeId])
    const reachableConns: ModelConnection[] = []
    let frontier = [startNodeId]
    while (frontier.length > 0) {
      const nextFrontier: string[] = []
      for (const nodeId of frontier) {
        for (const c of outgoing.get(nodeId) ?? []) {
          reachableConns.push(c)
          if (!reachableNodes.has(c.to)) {
            reachableNodes.add(c.to)
            nextFrontier.push(c.to)
          }
        }
      }
      frontier = nextFrontier
    }

    // Build tasks
    const tasks = new Map<string, FlowTask>()

    // Compute node duration hint from effect graph
    const nodeDuration = (nodeId: string) => {
      const node = model.nodes.find(n => n.id === nodeId)
      const hasEffects = node && ((node.flowEffects?.length ?? 0) > 0 || !!node.mediaType)
      return hasEffects ? 0 : 100 // 0 = will be computed at execution time
    }

    // Create node tasks
    for (const nodeId of reachableNodes) {
      const taskId = `node:${nodeId}`
      // Node depends on all incoming wire tasks from reachable connections
      const incomingWireDeps = (nodeId === startNodeId)
        ? []
        : reachableConns
            .filter(c => c.to === nodeId)
            .map(c => `wire:${c.from}->${c.to}`)
      tasks.set(taskId, {
        id: taskId,
        kind: 'node',
        nodeId,
        durationMs: nodeDuration(nodeId),
        dependsOn: incomingWireDeps,
        startTime: 0,
      })
    }

    // Create wire tasks
    for (const c of reachableConns) {
      const taskId = `wire:${c.from}->${c.to}`
      tasks.set(taskId, {
        id: taskId,
        kind: 'wire',
        connectionKey: `${c.from}->${c.to}`,
        durationMs: 600,
        dependsOn: [`node:${c.from}`],
        startTime: 0,
      })
    }

    if (tasks.size === 0) return

    const dag: FlowDAG = {
      tasks,
      activeTasks: new Set<string>(),
      completedTasks: new Set<string>(),
      untrackedPaths: new Set<string>(),
    }
    flowDAGRef.current = dag

    // Hide nodes that have an 'emerge' effect — they should be invisible until their emerge executes
    // Also collapse incoming connections to zero length via emergeAnimations
    const initialEmergeAnims = new Map<string, number>()
    for (const nodeId of reachableNodes) {
      const n = model.nodes.find(nn => nn.id === nodeId)
      if (!n?.flowEffects) continue
      const hasEmerge = n.flowEffects.some(eff =>
        eff.graph.nodes.some(gn => gn.kind === 'emerge')
      )
      if (hasEmerge) {
        const el = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null
        if (el) {
          el.style.opacity = '0'
          emergeHiddenElementsRef.current.push(el)
        }
        // Collapse all incoming flow connections to this node
        for (const c of model.connections) {
          if (c.to === nodeId && c.type === 'flow') {
            initialEmergeAnims.set(`${c.from}->${c.to}`, 0)
          }
        }
      }
    }
    if (initialEmergeAnims.size > 0) setEmergeAnimations(initialEmergeAnims)

    // Check if any reachable node has cameraTracked — if so, enable flow camera
    const anyTracked = [...reachableNodes].some(nid => {
      const n = model.nodes.find(nn => nn.id === nid)
      return n?.cameraTracked === true
    })
    if (anyTracked) {
      flowCameraRef.current = {
        preFlowPan: { x: panOffsetRef.current.x, y: panOffsetRef.current.y },
        preFlowScale: freeScaleRef.current,
        lastTrackedCenter: null,
        active: true,
      }
    }

    // Helper: mark a task as untracked and propagate
    const markUntracked = (taskId: string) => {
      dag.untrackedPaths.add(taskId)
    }

    // Helper: check & set tracking status for a newly activated task
    const resolveTracking = (taskId: string, task: FlowTask) => {
      if (task.kind === 'wire') {
        // Wire inherits from its source node task
        if (dag.untrackedPaths.has(task.dependsOn[0])) markUntracked(taskId)
      } else {
        // Node: untracked if node.cameraTracked !== true, OR all incoming wires are untracked
        const nodeModel = model.nodes.find(n => n.id === task.nodeId)
        if (nodeModel?.cameraTracked !== true) {
          markUntracked(taskId)
        } else if (task.dependsOn.length > 0 && task.dependsOn.every(dep => dag.untrackedPaths.has(dep))) {
          markUntracked(taskId)
        }
      }
    }

    // Activate tasks with no dependencies (just the start node)
    const now = performance.now()
    for (const [id, task] of tasks) {
      if (task.dependsOn.length === 0) {
        task.startTime = now
        dag.activeTasks.add(id)
        resolveTracking(id, task)
        if (task.kind === 'node') {
          setFlowActiveNodes(prev => new Set([...prev, task.nodeId]))
          const dur = executeNodeEffects(task.nodeId)
          if (task.durationMs === 0) task.durationMs = Math.max(dur + 100, 200)
        }
      }
    }

    // Build a node-position lookup for camera focus computation
    const nodePositions = new Map<string, { x: number; y: number }>()
    for (const n of model.nodes) {
      nodePositions.set(n.id, { x: n.x, y: n.y })
    }

    const rmmCameraScale = frame.snapshot.cameraScale

    const tick = (now: number) => {
      const d = flowDAGRef.current
      if (!d) return

      // Advance all active tasks
      const justCompleted: string[] = []
      const wireUpdates = new Map<string, number>()

      for (const taskId of d.activeTasks) {
        const task = d.tasks.get(taskId)!
        const elapsed = now - task.startTime
        const progress = Math.min(elapsed / task.durationMs, 1)

        if (task.kind === 'wire') {
          wireUpdates.set(task.connectionKey, progress)
        }

        if (progress >= 1 || (task.kind === 'node' && flowMediaDoneRef.current.has(task.nodeId))) {
          justCompleted.push(taskId)
        }
      }

      // Batch wire animation updates
      if (wireUpdates.size > 0) {
        setFlowAnimations(prev => {
          const next = new Map(prev)
          for (const [key, prog] of wireUpdates) next.set(key, prog)
          return next
        })
      }

      // Process completions and activate dependents
      if (justCompleted.length > 0) {
        for (const taskId of justCompleted) {
          d.activeTasks.delete(taskId)
          d.completedTasks.add(taskId)
        }

        // Check all pending tasks — activate any whose ALL deps are now met
        for (const [id, task] of d.tasks) {
          if (d.activeTasks.has(id) || d.completedTasks.has(id)) continue
          if (task.dependsOn.every(dep => d.completedTasks.has(dep))) {
            task.startTime = now
            d.activeTasks.add(id)
            resolveTracking(id, task)
            if (task.kind === 'node') {
              setFlowActiveNodes(prev => new Set([...prev, task.nodeId]))
              const dur = executeNodeEffects(task.nodeId)
              if (task.durationMs === 0) task.durationMs = Math.max(dur + 100, 200)
            }
          }
        }
      }

      // ---- Camera tracking ----
      const cam = flowCameraRef.current
      const override = flowCameraOverrideRef.current
      if (cam?.active) {
        const vp = vpSizeRef.current
        const scale = effectiveScaleRef.current
        const curPanX = panOffsetRef.current.x
        const curPanY = panOffsetRef.current.y
        const lerpFactor = 0.08

        // Always run normal auto-tracking to compute base position
        const trackedPoints: { x: number; y: number }[] = []
        for (const taskId of d.activeTasks) {
          if (d.untrackedPaths.has(taskId)) continue
          const task = d.tasks.get(taskId)!
          if (task.kind === 'node') {
            const pos = nodePositions.get(task.nodeId)
            if (pos) trackedPoints.push(pos)
          } else {
            // Wire: interpolate between source and target
            const [fromId, toId] = task.connectionKey.split('->')
            const fromPos = nodePositions.get(fromId)
            const toPos = nodePositions.get(toId)
            if (fromPos && toPos) {
              const elapsed = now - task.startTime
              const progress = Math.min(elapsed / task.durationMs, 1)
              trackedPoints.push({
                x: fromPos.x + (toPos.x - fromPos.x) * progress,
                y: fromPos.y + (toPos.y - fromPos.y) * progress,
              })
            }
          }
        }

        // Compute base tracking pan target
        let basePanX = curPanX
        let basePanY = curPanY
        if (trackedPoints.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const p of trackedPoints) {
            if (p.x < minX) minX = p.x
            if (p.y < minY) minY = p.y
            if (p.x > maxX) maxX = p.x
            if (p.y > maxY) maxY = p.y
          }
          const focusX = (minX + maxX) / 2
          const focusY = (minY + maxY) / 2
          cam.lastTrackedCenter = { x: focusX, y: focusY }

          basePanX = vp.w / 2 - (focusX / 100) * SCENE_W * scale
          basePanY = vp.h / 2 - (focusY / 100) * SCENE_H * scale
        }

        if (override) {
          // Camera effect: each attribute has its own duration, easing, and reset mode.
          const elapsed = now - override.startTime
          const holdT = override.durationMs > 0 ? Math.min(elapsed / override.durationMs, 1) : 1

          // Easing functions
          const applyEasing = (t: number, easing: string) => {
            if (easing === 'ease-in') return t * t
            if (easing === 'ease-out') return 1 - (1 - t) * (1 - t)
            // ease-in-out
            return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
          }

          // Compute attribute progress based on reset mode + easing
          // For 'attr' mode: animate to target over first half of attr duration, revert over second half
          // For 'node' mode: animate to target over attr duration, hold, then revert over attr duration (starting when node is near expiry)
          // For 'persist': animate to target, stay there forever
          const attrProgress = (dur: number, resetMode: string, easing: string) => {
            if (dur <= 0) return resetMode === 'persist' ? 1 : 0
            if (resetMode === 'attr') {
              // There-and-back: use attr duration for both halves
              const at = Math.min(elapsed / dur, 1)
              if (at <= 0.5) {
                return applyEasing(at / 0.5, easing)
              } else {
                return 1 - applyEasing((at - 0.5) / 0.5, easing)
              }
            } else if (resetMode === 'node') {
              // Animate to target over attr duration
              const at = Math.min(elapsed / dur, 1)
              const forward = applyEasing(at, easing)
              // Start reverting when remaining hold time equals attr duration
              const remainingMs = override.durationMs - elapsed
              if (remainingMs < dur) {
                const revertT = Math.min(1 - remainingMs / dur, 1)
                return forward * (1 - applyEasing(revertT, easing))
              }
              return forward
            } else {
              // 'persist': animate to target, stay there
              const at = Math.min(elapsed / dur, 1)
              return applyEasing(at, easing)
            }
          }

          const panXProgress = attrProgress(override.panXDurationMs, override.panXResetMode, override.panXEasing)
          const panYProgress = attrProgress(override.panYDurationMs, override.panYResetMode, override.panYEasing)
          const zoomProgress = attrProgress(override.zoomDurationMs, override.zoomResetMode, override.zoomEasing)
          const rotProgress = attrProgress(override.rotationDurationMs, override.rotationResetMode, override.rotationEasing)

          // Compute base pan using the pre-override scale so zoom changes don't affect tracking
          const baseScale = rmmCameraScale * override.startFreeScale
          let trackPanX = curPanX, trackPanY = curPanY
          if (trackedPoints.length > 0) {
            const focus = cam.lastTrackedCenter!
            trackPanX = vp.w / 2 - (focus.x / 100) * SCENE_W * baseScale
            trackPanY = vp.h / 2 - (focus.y / 100) * SCENE_H * baseScale
          }

          // Pan: offset in scene-percentage units, converted to screen pixels
          const pxPerSceneX = SCENE_W * baseScale / 100
          const pxPerSceneY = SCENE_H * baseScale / 100
          const targetPanX = trackPanX + override.panX * pxPerSceneX * panXProgress
          const targetPanY = trackPanY + override.panY * pxPerSceneY * panYProgress
          const newPanX = curPanX + (targetPanX - curPanX) * lerpFactor
          const newPanY = curPanY + (targetPanY - curPanY) * lerpFactor
          setPanOffset(newPanX, newPanY)

          // Zoom: lerp freeScale toward target based on zoomProgress
          if (override.zoom !== 1) {
            const targetFreeScale = override.startFreeScale + (override.startFreeScale * override.zoom - override.startFreeScale) * zoomProgress
            const curFS = freeScaleRef.current
            setFreeScale(curFS + (targetFreeScale - curFS) * lerpFactor)
          }

          // Rotation
          setFlowRotation(override.rotation * rotProgress)

          if (holdT >= 1) {
            // Hold duration expired — snapshot residuals for smooth fadeout
            const residualRot = override.rotationResetMode === 'persist'
              ? override.rotation * rotProgress
              : override.rotation * rotProgress // whatever is left
            const residualFSOffset = override.zoom !== 1
              ? freeScaleRef.current - override.startFreeScale
              : 0
            flowCameraOverrideRef.current = null
            // Only create fadeout if there's something to fade
            if (Math.abs(residualRot) > 0.01 || Math.abs(residualFSOffset) > 0.001) {
              flowCameraFadeoutRef.current = {
                rotation: residualRot,
                freeScaleOffset: residualFSOffset,
                startFreeScale: override.startFreeScale,
              }
            } else {
              flowCameraFadeoutRef.current = null
              setFlowRotation(0)
              if (override.zoom !== 1) setFreeScale(override.startFreeScale)
            }
          }
        } else {
          // No override — apply base tracking + smooth fadeout of residuals
          const fadeout = flowCameraFadeoutRef.current

          if (fadeout && Math.abs(fadeout.freeScaleOffset) > 0.001) {
            // During zoom fadeout, use the stable startFreeScale for pan computation
            // to avoid the SE jump caused by changing freeScale shifting the pan target
            const stableScale = rmmCameraScale * fadeout.startFreeScale
            let stablePanX = curPanX, stablePanY = curPanY
            if (trackedPoints.length > 0 && cam.lastTrackedCenter) {
              const focus = cam.lastTrackedCenter
              stablePanX = vp.w / 2 - (focus.x / 100) * SCENE_W * stableScale
              stablePanY = vp.h / 2 - (focus.y / 100) * SCENE_H * stableScale
            }
            setPanOffset(
              curPanX + (stablePanX - curPanX) * lerpFactor,
              curPanY + (stablePanY - curPanY) * lerpFactor,
            )
          } else {
            const newPanX = curPanX + (basePanX - curPanX) * lerpFactor
            const newPanY = curPanY + (basePanY - curPanY) * lerpFactor
            setPanOffset(newPanX, newPanY)
          }

          if (fadeout) {
            // Smoothly lerp residual rotation and zoom back to zero
            const fadeRate = 0.06 // per frame decay

            if (Math.abs(fadeout.rotation) > 0.01) {
              fadeout.rotation *= (1 - fadeRate)
              setFlowRotation(fadeout.rotation)
            } else {
              fadeout.rotation = 0
              setFlowRotation(0)
            }

            if (Math.abs(fadeout.freeScaleOffset) > 0.001) {
              fadeout.freeScaleOffset *= (1 - fadeRate)
              setFreeScale(fadeout.startFreeScale + fadeout.freeScaleOffset)
            } else {
              fadeout.freeScaleOffset = 0
              setFreeScale(fadeout.startFreeScale)
            }

            // Clear fadeout when everything has settled
            if (fadeout.rotation === 0 && fadeout.freeScaleOffset === 0) {
              flowCameraFadeoutRef.current = null
            }
          }
        }
      }

      // Check if all tasks are complete
      if (d.activeTasks.size === 0 && d.completedTasks.size === d.tasks.size) {
        // All done — keep final state briefly then clear
        flowTimeoutRef.current = setTimeout(() => {
          setFlowAnimations(new Map())
          setFlowActiveNodes(new Set())
          flowDAGRef.current = null
          flowMediaDoneRef.current.clear()
          // Stop flow recording and download result
          if (flowRecorderRef.current && flowRecorderRef.current.state !== 'inactive') {
            flowRecorderRef.current.stop()
            // onstop handler will assemble blob, download, and restore UI
          } else {
            // Stop stream tracks if recording never started
            if (flowRecordStreamRef.current) {
              flowRecordStreamRef.current.getTracks().forEach(t => t.stop())
              flowRecordStreamRef.current = null
            }
            setForceCollapseSidebars(false)
            setHideToolbar(false)
          }
          flowCameraOverrideRef.current = null
          flowCameraFadeoutRef.current = null
          restoreBrokenNodes()
          restoreEmergeNodes()
          // Restore colors changed by permanent color effects
          for (const { el, bg } of flowColorBackupsRef.current) {
            el.style.transition = 'background 400ms ease'
            el.style.background = bg
            setTimeout(() => { el.style.transition = '' }, 400)
          }
          flowColorBackupsRef.current = []
          // Clear scale revert timers
          for (const t of scaleRevertTimersRef.current) clearTimeout(t)
          scaleRevertTimersRef.current = []
          // Stop all playing media elements
          document.querySelectorAll('[data-node-id] video, [data-node-id] audio').forEach(el => {
            const media = el as HTMLVideoElement | HTMLAudioElement
            if (!media.paused) media.pause()
          })
          // Camera return animation
          const c = flowCameraRef.current
          if (c?.active) {
            const startPan = { x: panOffsetRef.current.x, y: panOffsetRef.current.y }
            const startScale = freeScaleRef.current
            const startRot = flowRotation
            const targetPan = c.preFlowPan
            const targetScale = c.preFlowScale
            const animStart = performance.now()
            const duration = 500
            const animateBack = (t: number) => {
              const p = Math.min((t - animStart) / duration, 1)
              const ease = 1 - (1 - p) * (1 - p)
              setPanOffset(
                startPan.x + (targetPan.x - startPan.x) * ease,
                startPan.y + (targetPan.y - startPan.y) * ease,
              )
              setFreeScale(startScale + (targetScale - startScale) * ease)
              setFlowRotation(startRot * (1 - ease))
              if (p < 1) requestAnimationFrame(animateBack)
            }
            requestAnimationFrame(animateBack)
            flowCameraRef.current = null
          } else {
            setFlowRotation(0)
          }
        }, 400)
      } else {
        flowAnimRef.current = requestAnimationFrame(tick)
      }
    }

    flowAnimRef.current = requestAnimationFrame(tick)
  }, [model.connections, model.nodes, stopFlowAnimation, executeNodeEffects, setPanOffset, setFreeScale, flowRotation])

  // Keep a stable ref so async RMM handoff callbacks can call the latest version
  const startFlowAnimationRef = useRef(startFlowAnimation)
  startFlowAnimationRef.current = startFlowAnimation

  // Cleanup on unmount
  useEffect(() => () => {
    if (flowAnimRef.current != null) cancelAnimationFrame(flowAnimRef.current)
    if (flowTimeoutRef.current != null) clearTimeout(flowTimeoutRef.current)
  }, [])

  // Check if selected node is part of a flow
  const selectedNodeIsInFlow = useMemo(() => {
    if (!selectedNode) return false
    return model.connections.some(c => c.type === 'flow' && (c.from === selectedNode.id || c.to === selectedNode.id))
  }, [selectedNode, model.connections])

  // ---- Node creation (double-click on empty space) ----
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingContentNodeId, setEditingContentNodeId] = useState<string | null>(null)

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

  // ---- Drop from sidebar (shape/media-type palette) and file drops ----

  /** Detect the media node type from a MIME type */
  const mimeToMediaType = (mime: string): MediaNodeType | null => {
    if (mime === 'image/gif') return 'gif'
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.startsWith('video/')) return 'video'
    return null
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes('application/unigram-shape') ||
      e.dataTransfer.types.includes('application/unigram-media-type') ||
      e.dataTransfer.types.includes('Files')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    // 1) Shape from sidebar
    const shapeId = e.dataTransfer.getData('application/unigram-shape')
    if (shapeId) {
      e.preventDefault()
      endDrag()
      lastPointer.current = null
      const pos = clientToScene(e.clientX, e.clientY)
      const snappedX = snapToGrid(pos.x)
      const snappedY = snapToGrid(pos.y)
      const newId = `node-${Date.now()}`
      addNode(frame.modelId, {
        id: newId, label: '', x: snappedX, y: snappedY,
        shape: shapeId as NodeShape,
      })
      selectNode(newId)
      setEditingNodeId(newId)
      return
    }

    // 2) Media type node from sidebar (empty media node)
    const mediaTypeId = e.dataTransfer.getData('application/unigram-media-type')
    if (mediaTypeId) {
      e.preventDefault()
      endDrag()
      lastPointer.current = null
      const pos = clientToScene(e.clientX, e.clientY)
      const snappedX = snapToGrid(pos.x)
      const snappedY = snapToGrid(pos.y)
      const newId = `node-${Date.now()}`
      const defaultSizes: Record<string, { w: number; h: number }> = {
        image: { w: 160, h: 120 },
        gif: { w: 160, h: 120 },
        audio: { w: 200, h: 80 },
        video: { w: 200, h: 140 },
        markdown: { w: 240, h: 60 },
        math: { w: 200, h: 60 },
      }
      const sz = defaultSizes[mediaTypeId] ?? { w: 160, h: 120 }
      const isContentType = mediaTypeId === 'markdown' || mediaTypeId === 'math'
      addNode(frame.modelId, {
        id: newId, label: isContentType ? (mediaTypeId === 'markdown' ? 'Markdown' : 'Math') : '', x: snappedX, y: snappedY,
        shape: 'rounded-rect',
        mediaType: mediaTypeId as MediaNodeType,
        nodeWidth: sz.w, nodeHeight: sz.h,
        ...(isContentType ? { contentSource: '', contentCollapsed: true } : {}),
      })
      selectNode(newId)
      if (isContentType) {
        setEditingContentNodeId(newId)
      }
      return
    }

    // 3) File drop from OS — either onto empty scene or onto existing media node
    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      const mType = mimeToMediaType(file.type)
      if (!mType) return
      e.preventDefault()
      endDrag()
      lastPointer.current = null

      // Check if dropped on an existing media node
      const target = e.target as HTMLElement
      const hostNode = target.closest('.host-node')
      const hostNodeId = hostNode?.getAttribute('data-node-id')
      const existingNode = hostNodeId
        ? model.nodes.find((n) => n.id === hostNodeId && n.mediaType)
        : undefined

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        if (existingNode) {
          // Image dropped on an audio node → set as cover image instead of replacing media
          if (existingNode.mediaType === 'audio' && (mType === 'image' || mType === 'gif')) {
            updateNodeProps(frame.modelId, existingNode.id, {
              audioCoverSrc: dataUrl,
            })
            const img = new Image()
            img.onload = () => {
              const maxW = 400, maxH = 400
              let w = img.naturalWidth, h = img.naturalHeight + 40 // extra height for audio controls
              if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h)
                w = Math.round(w * ratio)
                h = Math.round(h * ratio)
              }
              w = Math.max(w, 100)
              h = Math.max(h, 80)
              updateNodeProps(frame.modelId, existingNode.id, {
                nodeWidth: w, nodeHeight: h,
              })
            }
            img.src = dataUrl
          } else {
            // Drop onto existing media node — replace its media and auto-size for images/gifs/video
            updateNodeProps(frame.modelId, existingNode.id, {
              mediaSrc: dataUrl,
              mediaFileName: file.name,
            })
            if (mType === 'image' || mType === 'gif') {
              const img = new Image()
              img.onload = () => {
                const maxW = 400, maxH = 400
                let w = img.naturalWidth, h = img.naturalHeight
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h)
                  w = Math.round(w * ratio)
                  h = Math.round(h * ratio)
                }
                w = Math.max(w, 60)
                h = Math.max(h, 40)
                updateNodeProps(frame.modelId, existingNode.id, {
                  nodeWidth: w, nodeHeight: h,
                })
              }
              img.src = dataUrl
            } else if (mType === 'video') {
              const vid = document.createElement('video')
              vid.onloadedmetadata = () => {
                const maxW = 400, maxH = 400
                let w = vid.videoWidth, h = vid.videoHeight
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h)
                  w = Math.round(w * ratio)
                  h = Math.round(h * ratio)
                }
                w = Math.max(w, 100)
                h = Math.max(h, 80)
                updateNodeProps(frame.modelId, existingNode.id, {
                  nodeWidth: w, nodeHeight: h,
                })
              }
              vid.src = dataUrl
            }
          }
        } else {
          // Drop onto empty scene — create a new media node
          const pos = clientToScene(e.clientX, e.clientY)
          const snappedX = snapToGrid(pos.x)
          const snappedY = snapToGrid(pos.y)
          const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          const defaultSizes: Record<string, { w: number; h: number }> = {
            image: { w: 160, h: 120 },
            gif: { w: 160, h: 120 },
            audio: { w: 200, h: 80 },
            video: { w: 200, h: 140 },
            markdown: { w: 240, h: 60 },
            math: { w: 200, h: 60 },
          }
          const sz = defaultSizes[mType] ?? { w: 160, h: 120 }
          addNode(frame.modelId, {
            id: newId, label: '', x: snappedX, y: snappedY,
            shape: 'rounded-rect',
            mediaType: mType,
            mediaSrc: dataUrl,
            mediaFileName: file.name,
            nodeWidth: sz.w, nodeHeight: sz.h,
          })
          selectNode(newId)
          // Auto-size to image/video natural dimensions
          if (mType === 'image' || mType === 'gif') {
            const img = new Image()
            img.onload = () => {
              const maxW = 400, maxH = 400
              let w = img.naturalWidth, h = img.naturalHeight
              if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h)
                w = Math.round(w * ratio)
                h = Math.round(h * ratio)
              }
              w = Math.max(w, 60)
              h = Math.max(h, 40)
              updateNodeProps(frame.modelId, newId, { nodeWidth: w, nodeHeight: h })
            }
            img.src = dataUrl
          } else if (mType === 'video') {
            const vid = document.createElement('video')
            vid.onloadedmetadata = () => {
              const maxW = 400, maxH = 400
              let w = vid.videoWidth, h = vid.videoHeight
              if (w > maxW || h > maxH) {
                const ratio = Math.min(maxW / w, maxH / h)
                w = Math.round(w * ratio)
                h = Math.round(h * ratio)
              }
              w = Math.max(w, 100)
              h = Math.max(h, 80)
              updateNodeProps(frame.modelId, newId, { nodeWidth: w, nodeHeight: h })
            }
            vid.src = dataUrl
          }
        }
      }
      reader.readAsDataURL(file)
      return
    }
  }, [clientToScene, frame.modelId, addNode, selectNode, endDrag, model.nodes, updateNodeProps])

  // ---- Node deletion (Delete key) + Undo/Redo + Copy/Paste ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore non-modifier keys when focus is on a form input (sidebar fields, etc.)
      const tag = (e.target as HTMLElement)?.tagName
      const inFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (inFormField && !e.ctrlKey && !e.metaKey) return

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
        if (editingNodeId || inFormField) return // don't intercept text copy in edit mode or form fields
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
        if (editingNodeId || inFormField) return
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
            addConnection(frame.modelId, { from: newFrom, to: newTo, type: conn.type })
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
          return
        }
        // Delete selected connection
        if (unzipPopup) {
          const conn = model.connections.find(c => `${c.from}->${c.to}` === unzipPopup.connectionKey)
          if (conn) {
            beginEditNode(frame.modelId)
            removeConnection(frame.modelId, conn.from, conn.to)
            closeUnzip()
          }
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
  }, [frame.selectedNodeId, frame.modelId, editingNodeId, model.nodes, model.connections, selectedNodeIds, removeNode, removeConnection, clearSelection, closeUnzip, undo, redo, beginEditNode, addNode, addConnection, unzipPopup])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSave = useCallback(async () => {
    const blob = await exportBundle(storeModels, modelCosmetics, appThemeMode)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'unigram-project.unigram'
    a.click()
    URL.revokeObjectURL(url)
  }, [storeModels, modelCosmetics, appThemeMode])

  const handleLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.name.endsWith('.unigram') || file.name.endsWith('.zip')) {
      // Bundle format
      importBundle(file, registerModel, resetToRoot, (settings) => {
        if (settings.appThemeMode) setAppThemeMode(settings.appThemeMode)
        if (settings.modelCosmetics) {
          for (const [modelId, cos] of Object.entries(settings.modelCosmetics)) {
            setModelCosmetics(modelId, cos)
          }
        }
      }).catch((err) => {
        console.error('Failed to load bundle:', err)
      })
    } else {
      // Legacy JSON format
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string)
          clearLoaderCache()
          const basePath = '/models/'
          for (const [filename, fileData] of Object.entries(data)) {
            const modelFile = fileData as { id: string }
            registerModelUrl(modelFile.id, basePath + filename)
          }
          for (const [, fileData] of Object.entries(data)) {
            const mf = fileData as {
              id: string; label: string
              nodes: { id: string; label: string; x: number; y: number; childModel?: string; mpdModels?: string[] }[]
              connections: { from: string; to: string; evidence?: { title: string; citation: string; url: string }[] }[]
            }
            const idLookup = new Map<string, string>()
            for (const [fn, fd] of Object.entries(data)) {
              const m = fd as { id: string }
              idLookup.set('./' + fn, m.id)
              idLookup.set(fn, m.id)
            }
            registerModel({
              id: mf.id,
              label: mf.label,
              nodes: mf.nodes.map((n) => ({
                id: n.id, label: n.label, x: n.x, y: n.y,
                childModelId: n.childModel ? idLookup.get(n.childModel) : undefined,
                mpdIds: n.mpdModels?.length
                  ? n.mpdModels.map((p) => idLookup.get(p)).filter(Boolean) as string[]
                  : undefined,
              })),
              connections: mf.connections,
            })
          }
          resetToRoot()
        } catch (err) {
          console.error('Failed to load project file:', err)
        }
      }
      reader.readAsText(file)
    }
    e.target.value = ''
  }, [registerModel, resetToRoot])

  // ---- Auto-untangle animation ----
  const [isUntangling, setIsUntangling] = useState(false)
  const untangleRaf = useRef<number>(0)

  const handleUntangle = useCallback(() => {
    if (isUntangling) return
    const targets = computeUntangledPositions(model.nodes, model.connections, SCENE_W, SCENE_H, gridSnap)
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
      className={`viewport ${isDragging ? 'dragging' : ''}${selectionRect ? ' select-mode' : ''}`}
      style={bgConfig?.type !== 'image' ? bgStyle : undefined}
      onWheel={(event) => {
        event.preventDefault()
        // Cancel any running untangle animation before zooming
        if (isUntangling) {
          cancelAnimationFrame(untangleRaf.current)
          setIsUntangling(false)
        }
        const zoomingIn = event.deltaY < 0
        const hasSelection = !!frame.selectedNodeId
        const canRmmIn = selectedNode && selectedNode.childModelId
        const canRmmOut = stack.length > 1 || frame.snapshot.progress > 0

        if (hasSelection) {
          // With a selection: use default RMM zoom only, no free zoom
          if (zoomingIn) {
            zoomIn()
          } else {
            zoomOut()
          }
        } else {
          // Free zoom — anchor to cursor position
          const doFreeZoom = zoomingIn || frame.freeScale > 1 || !canRmmOut
          if (!doFreeZoom) {
            zoomOut()
          } else {
            const rect = viewportRef.current?.getBoundingClientRect()
            if (rect) {
              // Cursor position relative to viewport center
              const cx = event.clientX - rect.left - rect.width / 2
              const cy = event.clientY - rect.top - rect.height / 2
              const oldScale = effectiveScale
              const factor = zoomingIn ? 1.08 : 1 / 1.08
              const newFreeScale = Math.min(5, Math.max(0.2, frame.freeScale * factor))
              const newScale = frame.snapshot.cameraScale * newFreeScale
              // Adjust pan so the scene point under the cursor stays fixed
              const newPanX = cx - (cx - frame.panOffset.x) * newScale / oldScale
              const newPanY = cy - (cy - frame.panOffset.y) * newScale / oldScale
              setFreeScale(newFreeScale)
              setPanOffset(newPanX, newPanY)
            } else {
              adjustFreeScale(zoomingIn ? 1 : -1)
            }
          }
        }
      }}
      onPointerDown={(event) => {
        const el = event.target as HTMLElement
        if (el.closest('.sidebar') || el.closest('.editor-toolbar')) return
        // Right-click on empty space: start selection rectangle
        if (event.button === 2 && !draggingNodeRef.current && !connectionDraft) {
          if (!el.closest('.host-node')) {
            event.preventDefault()
            selectionStartRef.current = { clientX: event.clientX, clientY: event.clientY }
            const pos = clientToScene(event.clientX, event.clientY)
            setSelectionRect({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y })
            return
          }
        }
        if (event.button !== 0) return
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
        // Deselect when clicking empty space — anything that isn't a node or interactive child
        const el = event.target as HTMLElement
        if (!el.closest('.host-node') && !el.closest('.connection-line') && !el.closest('.unzip-popup') && !el.closest('.sidebar') && !el.closest('.editor-toolbar')) {
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
      {/* Image background layer */}
      {bgConfig?.type === 'image' && bgConfig.value && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            backgroundImage: `url(${bgConfig.value})`,
            backgroundSize: bgConfig.fit === 'tile' ? 'auto' : (bgConfig.fit ?? 'cover'),
            backgroundPosition: 'center',
            backgroundRepeat: bgConfig.fit === 'tile' ? 'repeat' : 'no-repeat',
            opacity: bgConfig.opacity ?? 1,
            filter: bgConfig.blur ? `blur(${bgConfig.blur}px)` : undefined,
            pointerEvents: 'none',
            clipPath: mpdCurtain
              ? mpdCurtain.direction === 'left'
                ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
                : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`
              : 'inset(0)',
          }}
        />
      )}

      {/* Ambient particle overlay — clipped to new side during curtain */}
      <div
        ref={particleContainerRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          clipPath: mpdCurtain
            ? mpdCurtain.direction === 'left'
              ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
              : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`
            : 'inset(0)',
        }}
      >
        {particlePresetId && (
          <ParticleOverlay
            presetId={particlePresetId}
            sceneTx={sceneTx}
            sceneTy={sceneTy}
            sceneScale={effectiveScale}
            vpSize={SCENE_VP}
            gridExtent={gridExtent}
          />
        )}
      </div>

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
            <span>Camera: {effectiveScale.toFixed(2)}</span>
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
                  const cs = effectiveScale
                  const np = frame.snapshot.nodeProgress
                  const dx = (twinNode.x - oldNode.x) / 100 * SCENE_W * cs * (np - 1)
                  const dy = (twinNode.y - oldNode.y) / 100 * SCENE_H * cs * (np - 1)
                  alignPan = {
                    x: frame.panOffset.x + dx,
                    y: frame.panOffset.y + dy,
                  }
                }
              }

              const oldModel = model
              const oldStyle = { ...sceneStyle }
              const oldBgSt = bgStyle ? { ...bgStyle } : undefined
              const oldBgCfg = bgConfig ? { ...bgConfig } : undefined
              const oldSizes = new Map(liveNodeSizesRef.current)
              const oldGE = { ...gridExtent }
              const oldGBG = gridBackgroundImage(gridConfig)
              const oldGPW = gridPxW
              const oldGPH = gridPxH
              // Capture a snapshot of the particle canvas for the old-side curtain
              let pScreenshot: string | null = null
              const pCanvas = particleContainerRef.current?.querySelector('canvas')
              if (pCanvas) { try { pScreenshot = pCanvas.toDataURL() } catch (_) { /* tainted canvas */ } }
              cancelAnimationFrame(curtainRaf.current)
              flushSync(() => {
                setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, oldBgStyle: oldBgSt, oldBgConfig: oldBgCfg, particleScreenshot: pScreenshot, oldNodeSizes: oldSizes, oldGridExtent: oldGE, oldGridBgImage: oldGBG, oldGridPxW: oldGPW, oldGridPxH: oldGPH, progress: 0, direction })
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
                const cs = effectiveScale
                const np = frame.snapshot.nodeProgress
                let cx = 0, cy = 0
                if (selectedNode) {
                  cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs
                  cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs
                }
                // Old node screen position (relative to viewport center)
                const oldScreenX = cx + frame.panOffset.x + (oldNode.x / 100 * SCENE_W - vpSize.w / 2) * cs
                const oldScreenY = cy + frame.panOffset.y + (oldNode.y / 100 * SCENE_H - vpSize.h / 2) * cs
                // New frame: scale=1, no centering → solve for panOffset
                alignPan = {
                  x: oldScreenX - (twinNode.x / 100 * SCENE_W - vpSize.w / 2),
                  y: oldScreenY - (twinNode.y / 100 * SCENE_H - vpSize.h / 2),
                }
              }
            }

            // Capture current state for curtain
            const oldModel = model
            const oldStyle = { ...sceneStyle }
            const oldBgSt = bgStyle ? { ...bgStyle } : undefined
            const oldBgCfg = bgConfig ? { ...bgConfig } : undefined
            const oldSizes = new Map(liveNodeSizesRef.current)
            const oldGE = { ...gridExtent }
            const oldGBG = gridBackgroundImage(gridConfig)
            const oldGPW = gridPxW
            const oldGPH = gridPxH
            // Capture a snapshot of the particle canvas for the old-side curtain
            let pScreenshot: string | null = null
            const pCanvas = particleContainerRef.current?.querySelector('canvas')
            if (pCanvas) { try { pScreenshot = pCanvas.toDataURL() } catch (_) { /* tainted canvas */ } }
            cancelAnimationFrame(curtainRaf.current)
            // flushSync guarantees the clip-path wrapper is in the DOM
            // before switchFrameMpd changes the model, preventing a
            // single unclipped frame where all nodes would visibly jump.
            flushSync(() => {
              setMpdCurtain({ oldModel, oldSceneStyle: oldStyle, oldBgStyle: oldBgSt, oldBgConfig: oldBgCfg, particleScreenshot: pScreenshot, oldNodeSizes: oldSizes, oldGridExtent: oldGE, oldGridBgImage: oldGBG, oldGridPxW: oldGPW, oldGridPxH: oldGPH, progress: 0, direction })
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

      <div className="editor-toolbar" style={hideToolbar ? { visibility: 'hidden' } : undefined}>
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

        {selectedNodeIsInFlow && (
          <>
            <span className="toolbar-sep" />
            {flowDAGRef.current ? (
              <button
                type="button"
                className="toolbar-btn toolbar-btn-stop"
                onClick={stopFlowAnimation}
                title="Stop flow animation"
              >&#x25A0; Stop</button>
            ) : (
              <button
                type="button"
                className="toolbar-btn toolbar-btn-play"
                onClick={() => selectedNode && startFlowAnimation(selectedNode.id)}
                title="Play flow animation from selected node"
              >&#x25B6; Play</button>
            )}
          </>
        )}
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
          title="Load project"
        >&#x1F4C2; Load</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".unigram,.zip,.json"
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
          {/* Old background — always render to prevent new bg bleeding through */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              ...(mpdCurtain.oldBgConfig?.type === 'image' && mpdCurtain.oldBgConfig.value
                ? {
                    backgroundImage: `url(${mpdCurtain.oldBgConfig.value})`,
                    backgroundSize: mpdCurtain.oldBgConfig.fit === 'tile' ? 'auto' : (mpdCurtain.oldBgConfig.fit ?? 'cover'),
                    backgroundPosition: 'center',
                    backgroundRepeat: mpdCurtain.oldBgConfig.fit === 'tile' ? 'repeat' : 'no-repeat',
                    opacity: mpdCurtain.oldBgConfig.opacity ?? 1,
                    filter: mpdCurtain.oldBgConfig.blur ? `blur(${mpdCurtain.oldBgConfig.blur}px)` : undefined,
                  }
                : mpdCurtain.oldBgStyle
                  ? mpdCurtain.oldBgStyle
                  : { background: 'var(--ug-viewport-bg)' }),
            }}
          />
          {/* Old particles — frozen screenshot from transition start */}
          {mpdCurtain.particleScreenshot && (
            <img
              src={mpdCurtain.particleScreenshot}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            />
          )}
          <div
            className="scene"
            style={mpdCurtain.oldSceneStyle}
          >
            {/* Old grid */}
            <div style={{
              position: 'absolute',
              left: `${mpdCurtain.oldGridExtent.minX}%`,
              top: `${mpdCurtain.oldGridExtent.minY}%`,
              width: `${mpdCurtain.oldGridExtent.maxX - mpdCurtain.oldGridExtent.minX}%`,
              height: `${mpdCurtain.oldGridExtent.maxY - mpdCurtain.oldGridExtent.minY}%`,
              backgroundImage: mpdCurtain.oldGridBgImage,
              backgroundSize: `${mpdCurtain.oldGridPxW}px ${mpdCurtain.oldGridPxH}px`,
              pointerEvents: 'none',
            }} />
            <ModelSceneContent
              model={mpdCurtain.oldModel}
              selectedNodeId={null}
              childModel={undefined}
              progress={0}
              vpSize={SCENE_VP}
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
              flowAnimations={new Map()}
              emergeAnimations={new Map()}
              flowActiveNodes={new Set()}
              unzipGap={null}
              noTransition
              initialNodeSizes={mpdCurtain.oldNodeSizes}
            />
          </div>
        </div>
      )}

      {/* New/live scene – clip wrapper sits outside the transform so clip is in viewport coords */}
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: mpdCurtain
          ? mpdCurtain.direction === 'left'
            ? `inset(0 0 0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px))`
            : `inset(0 calc(${(1 - mpdCurtain.progress) * 100}% - 1px) 0 0)`
          : 'inset(0)',
      }}>
      {/* During curtain: new background inside clip wrapper */}
      {mpdCurtain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            ...(bgConfig?.type === 'image' && bgConfig.value
              ? {
                  backgroundImage: `url(${bgConfig.value})`,
                  backgroundSize: bgConfig.fit === 'tile' ? 'auto' : (bgConfig.fit ?? 'cover'),
                  backgroundPosition: 'center',
                  backgroundRepeat: bgConfig.fit === 'tile' ? 'repeat' : 'no-repeat',
                  opacity: bgConfig.opacity ?? 1,
                  filter: bgConfig.blur ? `blur(${bgConfig.blur}px)` : undefined,
                }
              : bgStyle
                ? bgStyle
                : { background: 'var(--ug-viewport-bg)' }),
          }}
        />
      )}
      <div
        className="scene"
        style={{
          ...sceneStyle,
          ...(shakeOffset.x !== 0 || shakeOffset.y !== 0
            ? { marginLeft: shakeOffset.x, marginTop: shakeOffset.y }
            : {}),
        }}
      >
        {/* Dynamic grid — auto-extends with node positions */}
        <div style={{
          position: 'absolute',
          left: `${gridExtent.minX}%`,
          top: `${gridExtent.minY}%`,
          width: `${gridExtent.maxX - gridExtent.minX}%`,
          height: `${gridExtent.maxY - gridExtent.minY}%`,
          backgroundImage: gridBackgroundImage(gridConfig),
          backgroundSize: `${gridPxW}px ${gridPxH}px`,
          pointerEvents: 'none',
        }} />
        <ModelSceneContent
          model={model}
          selectedNodeId={frame.selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          childModel={childModel}
          progress={p}
          vpSize={SCENE_VP}
          onSelectNode={handleSelectNode}
          onDoubleClickNode={(nodeId) => {
            const n = model.nodes.find(nd => nd.id === nodeId)
            if (n && (n.mediaType === 'markdown' || n.mediaType === 'math')) {
              setEditingContentNodeId(nodeId)
            } else {
              beginEditNode(frame.modelId)
              setEditingNodeId(nodeId)
            }
          }}
          onClickConnection={openUnzip}
          onNodeDragStart={handleNodeDragStart}
          onConnectionDragStart={handleConnectionDragStart}
          draggingNodeId={draggingNodeId}
          draggingMultiIds={multiDragOffsetsRef.current.size > 0 ? selectedNodeIds : undefined}
          editingNodeId={editingNodeId}
          noTransition={!!mpdCurtain}
          onNodeSizesChanged={(sizes) => { liveNodeSizesRef.current = sizes }}
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
          flowAnimations={flowAnimations}
          emergeAnimations={emergeAnimations}
          flowActiveNodes={flowActiveNodes}
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
              return Math.atan2((tn.y - fn.y) * SCENE_H, (tn.x - fn.x) * SCENE_W)
            })()
          } : null}
          onSetMedia={(nodeId, src, name) => {
            beginEditNode(frame.modelId)
            updateNodeProps(frame.modelId, nodeId, { mediaSrc: src, mediaFileName: name })
            // Auto-size to media natural dimensions
            const node = model.nodes.find(n => n.id === nodeId)
            const mt = node?.mediaType
            if (mt === 'image' || mt === 'gif') {
              const img = new Image()
              img.onload = () => {
                const maxW = 400, maxH = 400
                let w = img.naturalWidth, h = img.naturalHeight
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h)
                  w = Math.round(w * ratio)
                  h = Math.round(h * ratio)
                }
                w = Math.max(w, 60)
                h = Math.max(h, 40)
                updateNodeProps(frame.modelId, nodeId, { nodeWidth: w, nodeHeight: h })
              }
              img.src = src
            } else if (mt === 'video') {
              const vid = document.createElement('video')
              vid.onloadedmetadata = () => {
                const maxW = 400, maxH = 400
                let w = vid.videoWidth, h = vid.videoHeight
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h)
                  w = Math.round(w * ratio)
                  h = Math.round(h * ratio)
                }
                w = Math.max(w, 100)
                h = Math.max(h, 80)
                updateNodeProps(frame.modelId, nodeId, { nodeWidth: w, nodeHeight: h })
              }
              vid.src = src
            }
          }}
          onToggleCollapse={(nodeId) => {
            const n = model.nodes.find(nd => nd.id === nodeId)
            if (!n) return
            const nowCollapsed = !(n.contentCollapsed !== false)
            updateNodeProps(frame.modelId, nodeId, { contentCollapsed: nowCollapsed })
            // Auto-resize: expand to fit content, collapse to compact
            if (!nowCollapsed) {
              // Expanding — use a larger default height
              const expandedH = Math.max(n.nodeHeight ?? 60, 160)
              updateNodeProps(frame.modelId, nodeId, { nodeHeight: expandedH })
            } else {
              // Collapsing — shrink back to compact
              updateNodeProps(frame.modelId, nodeId, { nodeHeight: 60 })
            }
          }}
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
                (toNode.y - fromNode.y) * SCENE_H,
                (toNode.x - fromNode.x) * SCENE_W,
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
        const cs = effectiveScale
        let cx = 0, cy = 0
        if (selectedNode) {
          const np = frame.snapshot.nodeProgress
          cx = (vpSize.w / 2 - selectedNode.x / 100 * SCENE_W) * np * cs
          cy = (vpSize.h / 2 - selectedNode.y / 100 * SCENE_H) * np * cs
        }
        const toScreen = (pctX: number, pctY: number) => ({
          x: (pctX / 100) * SCENE_W * cs + cx + frame.panOffset.x,
          y: (pctY / 100) * SCENE_H * cs + cy + frame.panOffset.y,
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

      <LeftSidebar connectionType={activeConnectionType} onConnectionTypeChange={setActiveConnectionType} forceCollapsed={forceCollapseSidebars} />
      <RightSidebar
        model={model}
        selectedNode={selectedNode}
        selectedNodeIds={selectedNodeIds}
        selectedConnection={selectedNode ? undefined : (unzipPopup
          ? model?.connections.find(c => `${c.from}->${c.to}` === unzipPopup.connectionKey)
          : undefined
        )}
        gridSnap={gridSnap}
        onSetGridSnap={setGridSnap}
        onUpdateNodeShape={(nodeId, shape) => updateNodeShape(frame.modelId, nodeId, shape)}
        onUpdateNodeProps={(nodeId, props) => updateNodeProps(frame.modelId, nodeId, props)}
        onBulkUpdateNodeProps={(nodeIds, props) => {
          for (const id of nodeIds) updateNodeProps(frame.modelId, id, props)
        }}
        onBulkUpdateNodeShape={(nodeIds, shape) => {
          for (const id of nodeIds) updateNodeShape(frame.modelId, id, shape)
        }}
        allModels={storeModels}
        onRegisterModel={registerModel}
        onUpdateModelLabel={updateModelLabel}
        onUpdateConnectionType={(from, to, type) => updateConnectionType(frame.modelId, from, to, type)}
        onUpdateConnectionProps={(from, to, props) => updateConnectionProps(frame.modelId, from, to, props)}
        onEditEffect={(nodeId, effectId) => setEditingEffect({ nodeId, effectId })}
        onEditContent={(nodeId) => setEditingContentNodeId(nodeId)}
        forceCollapsed={forceCollapseSidebars}
      />

      {/* Flow effect graph editor modal */}
      {editingEffect && (() => {
        const editNode = model.nodes.find(n => n.id === editingEffect.nodeId)
        // Find the effect — either from flowEffects or build the locked media virtual effect
        let editFx = editNode?.flowEffects?.find(e => e.id === editingEffect.effectId)
        if (!editFx && editingEffect.effectId === '__locked-media__' && editNode?.mediaType) {
          editFx = {
            id: '__locked-media__',
            label: `Play ${editNode.mediaType}`,
            locked: true,
            graph: {
              nodes: [
                { id: '__entry__', kind: 'entry' as const, label: 'Signal In', x: 60, y: 120, config: {} },
                { id: 'play-media-root', kind: 'play-media' as const, label: `Play ${editNode.mediaType}`, x: 300, y: 120, config: {} },
              ],
              edges: [{ from: '__entry__', to: 'play-media-root' }],
            },
          }
        }
        if (!editFx) return null
        const hostCtx: EffectEditorHostContext = {
          hasChildModel: !!editNode?.childModelId,
          isInsideChildModel: stack.length > 1,
          mpdIds: editNode?.mpdIds ?? [],
          mpdLabels: Object.fromEntries(
            (editNode?.mpdIds ?? []).map(id => [id, storeModels[id]?.label ?? id])
          ),
          mediaType: editNode?.mediaType,
        }
        return (
          <FlowEffectEditor
            effect={editFx}
            hostContext={hostCtx}
            onSave={(updated) => {
              if (!editNode) return
              if (updated.id === '__locked-media__') {
                // Materialise the locked effect into the flowEffects array
                const existing = editNode.flowEffects ?? []
                const lockedExists = existing.find(e => e.locked)
                if (lockedExists) {
                  updateNodeProps(frame.modelId, editNode.id, {
                    flowEffects: existing.map(e => e.id === lockedExists.id ? { ...updated, id: lockedExists.id } : e),
                  })
                } else {
                  const persisted = { ...updated, id: `fx-locked-${Date.now()}` }
                  updateNodeProps(frame.modelId, editNode.id, {
                    flowEffects: [persisted, ...existing],
                  })
                }
              } else {
                const existing = editNode.flowEffects ?? []
                updateNodeProps(frame.modelId, editNode.id, {
                  flowEffects: existing.map(e => e.id === updated.id ? updated : e),
                })
              }
              setEditingEffect(null)
            }}
            onClose={() => setEditingEffect(null)}
          />
        )
      })()}
      {/* Content editor popup for markdown/math nodes */}
      {editingContentNodeId && (() => {
        const editContentNode = model.nodes.find(n => n.id === editingContentNodeId)
        if (!editContentNode || (editContentNode.mediaType !== 'markdown' && editContentNode.mediaType !== 'math')) return null
        return (
          <ContentEditor
            contentType={editContentNode.mediaType as 'markdown' | 'math'}
            source={editContentNode.contentSource ?? ''}
            onSave={(source) => {
              updateNodeProps(frame.modelId, editingContentNodeId, { contentSource: source })
              setEditingContentNodeId(null)
            }}
            onClose={() => setEditingContentNodeId(null)}
          />
        )
      })()}
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
  flowAnimations,
  emergeAnimations,
  flowActiveNodes,
  unzipGap,
  noTransition,
  initialNodeSizes,
  onNodeSizesChanged,
  onSetMedia,
  onToggleCollapse,
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
  connectionDraft: { fromId: string; fromX: number; fromY: number; toX: number; toY: number; connectionType?: ConnectionType } | null
  flowAnimations: Map<string, number>
  emergeAnimations: Map<string, number>
  flowActiveNodes: Set<string>
  unzipGap: { connectionKey: string; progress: number; popupSize: { w: number; h: number } | null; connectionAngle: number } | null
  noTransition?: boolean
  initialNodeSizes?: Map<string, { w: number; h: number }>
  onNodeSizesChanged?: (sizes: Map<string, { w: number; h: number }>) => void
  onSetMedia?: (nodeId: string, mediaSrc: string, mediaFileName: string) => void
  onToggleCollapse?: (nodeId: string) => void
}) {
  // Theme palette for node default colors
  const appThemeMode = useHybridZoomStore((s) => s.appThemeMode)
  const palette = resolvePalette(appThemeMode)

  // Track actual measured node sizes for accurate anchor placement
  const nodeSizesRef = useRef<Map<string, { w: number; h: number }>>(new Map())
  // Pre-seed with initial sizes if provided (avoids first-render anchor jitter)
  if (nodeSizesRef.current.size === 0 && initialNodeSizes && initialNodeSizes.size > 0) {
    nodeSizesRef.current = new Map(initialNodeSizes)
  }
  const frozenSizes = !!initialNodeSizes
  const [sizeGen, setSizeGen] = useState(0)
  const onNodeSizesChangedRef = useRef(onNodeSizesChanged)
  onNodeSizesChangedRef.current = onNodeSizesChanged
  const handleNodeResize = useCallback((id: string, size: { w: number; h: number }) => {
    // When sizes are pre-seeded (frozen old scene), skip updates to prevent
    // the estimate→measure cycle from overwriting correct captured sizes
    if (frozenSizes) return
    const map = nodeSizesRef.current
    const prev = map.get(id)
    if (!prev || prev.w !== size.w || prev.h !== size.h) {
      map.set(id, size)
      setSizeGen(g => g + 1)
      onNodeSizesChangedRef.current?.(map)
    }
  }, [frozenSizes])

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
    const dxPx = (toN.x - fromN.x) * SCENE_W / 100
    const dyPx = (toN.y - fromN.y) * SCENE_H / 100
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
      dx: -ux * halfDeficit * 100 / SCENE_W,
      dy: -uy * halfDeficit * 100 / SCENE_H,
    }
    offsets[conn.to] = {
      dx: ux * halfDeficit * 100 / SCENE_W,
      dy: uy * halfDeficit * 100 / SCENE_H,
    }
    return offsets
  }, [model, unzipGap])

  // Helper: get spread-adjusted position for a node
  const pos = (node: ModelNode) => {
    const off = spreadOffsets[node.id]
    return off
      ? { x: node.x + off.dx, y: node.y + off.dy }
      : { x: node.x, y: node.y }
  }

  // Compute edge-anchored connection endpoints
  const anchors = useMemo(
    () => computeEdgeAnchors(model.nodes, model.connections, SCENE_W, SCENE_H, pos, nodeSizesRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, spreadOffsets, sizeGen],
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
          <marker id="arrowhead-flow" markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
          </marker>
          {/* Dynamic markers for custom arrow styles and colors */}
          {(() => {
            const markers: React.ReactNode[] = []
            const seen = new Set<string>()
            for (const c of model.connections) {
              const color = c.strokeColor || (c.type === 'flow' ? '#f59e0b' : (c.evidence?.length ? 'rgba(37, 96, 149, 0.65)' : 'rgba(37, 96, 149, 0.45)'))
              const style = c.arrowStyle ?? 'standard'
              // Custom-color standard arrowhead
              if (c.strokeColor && (style === 'standard' || !c.arrowStyle)) {
                const id = `arrowhead-custom-${CSS.escape(c.strokeColor)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill={c.strokeColor} />
                    </marker>
                  )
                }
              }
              // Triangle (filled, same as standard but distinct id for non-custom-color cases)
              if (style === 'triangle') {
                const id = `arrowhead-triangle-${CSS.escape(color)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="8" markerHeight="6" refX="0" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill={color} stroke={color} strokeWidth="0.5" />
                    </marker>
                  )
                }
              }
              // Diamond
              if (style === 'diamond') {
                const id = `arrowhead-diamond-${CSS.escape(color)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="10" markerHeight="8" refX="0" refY="4" orient="auto">
                      <polygon points="0 4, 5 0, 10 4, 5 8" fill={color} />
                    </marker>
                  )
                }
              }
              // Circle
              if (style === 'circle') {
                const id = `arrowhead-circle-${CSS.escape(color)}`
                if (!seen.has(id)) {
                  seen.add(id)
                  markers.push(
                    <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="0" refY="4" orient="auto">
                      <circle cx="4" cy="4" r="3.5" fill={color} />
                    </marker>
                  )
                }
              }
            }
            return markers
          })()}
        </defs>
        {model.connections.map((c) => {
          const fromN = model.nodes.find((n) => n.id === c.from)
          const toN = model.nodes.find((n) => n.id === c.to)
          if (!fromN || !toN) return null
          // Hide during flow if flagged
          const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
          if (c.hideDuringFlow && isFlowRunning) return null
          const key = `${c.from}->${c.to}`
          const hasEvidence = !!c.evidence?.length
          const a = anchors[key]
          if (!a) return null
          // Anchor midpoint (for popup positioning)
          const midX = (a.fx + a.tx) / 2
          const midY = (a.fy + a.ty) / 2
          const isUnzipping = unzipGap?.connectionKey === key
          const gapT = isUnzipping ? unzipGap.progress : 0
          // Emerge animation: interpolate the target endpoint from the source toward the final anchor
          const emergeT = emergeAnimations.get(key)
          const effToX = emergeT != null ? a.fx + (a.tx - a.fx) * emergeT : a.tx
          const effToY = emergeT != null ? a.fy + (a.ty - a.fy) * emergeT : a.ty
          const isFlow = c.type === 'flow'
          const baseStrokeWidth = c.strokeWidth ?? (isFlow ? 3 : 2)
          const emergeStrokeWidth = emergeT != null ? baseStrokeWidth * emergeT : undefined
          return (
            <g key={key}>
              <line
                x1={`${a.fx}%`} y1={`${a.fy}%`}
                x2={`${effToX}%`} y2={`${effToY}%`}
                className="connection-hit-area"
                onClick={(e) => {
                  e.stopPropagation()
                  onClickConnection(key, midX, midY)
                }}
              />
              <ConnectionLine
                fromX={a.fx} fromY={a.fy}
                toX={effToX} toY={effToY}
                hasEvidence={hasEvidence}
                connectionType={c.type}
                flowProgress={flowAnimations.get(key)}
                gapProgress={gapT}
                vpSize={vpSize}
                popupSize={isUnzipping ? unzipGap?.popupSize ?? null : null}
                connectionAngle={isUnzipping ? unzipGap?.connectionAngle ?? 0 : 0}
                strokeColor={c.strokeColor}
                strokeWidth={emergeStrokeWidth ?? c.strokeWidth}
                strokeDash={c.strokeDash}
                arrowStyle={c.arrowStyle}
              />
              {c.label && !isUnzipping && (
                <text
                  x={`${midX}%`}
                  y={`${midY}%`}
                  className="connection-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: `${c.labelFontSize ?? 0.85}rem` }}
                >
                  {c.label}
                </text>
              )}
            </g>
          )
        })}
        {connectionDraft && (
          <line
            x1={`${connectionDraft.fromX}%`} y1={`${connectionDraft.fromY}%`}
            x2={`${connectionDraft.toX}%`} y2={`${connectionDraft.toY}%`}
            className={connectionDraft.connectionType === 'flow' ? 'connection-draft flow' : 'connection-draft'}
          />
        )}
      </svg>
      {model.nodes.map((node) => {
        const isFlowRunning = flowActiveNodes.size > 0 || flowAnimations.size > 0
        if (node.hideDuringFlow && isFlowRunning) return null
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
            isFlowActive={flowActiveNodes.has(node.id)}
            isFlowRunning={isFlowRunning}
            onFinishEditing={(label) => onFinishEditing(node.id, label)}
            onLiveEditLabel={(label) => onLiveEditLabel(node.id, label)}
            onResize={(size) => handleNodeResize(node.id, size)}
            defaultCellColor={palette.nodeCell}
            defaultMembraneColor={palette.nodeMembrane}
            onSetMedia={onSetMedia ? (src, name) => onSetMedia(node.id, src, name) : undefined}
            onToggleCollapse={onToggleCollapse ? () => onToggleCollapse(node.id) : undefined}
          />
        )
      })}
    </>
  )
}

/** Connection line that bows outward into a zipper-bag shape during unzip */
function ConnectionLine({
  fromX, fromY, toX, toY, hasEvidence, connectionType, flowProgress, gapProgress, vpSize, popupSize, connectionAngle,
  strokeColor, strokeWidth: customStrokeWidth, strokeDash, arrowStyle,
}: {
  fromX: number; fromY: number
  toX: number; toY: number
  hasEvidence: boolean
  connectionType?: ConnectionType
  flowProgress?: number
  gapProgress: number
  vpSize: { w: number; h: number }
  popupSize: { w: number; h: number } | null
  connectionAngle: number
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: ConnectionDashStyle
  arrowStyle?: ConnectionArrowStyle
}) {
  const isFlow = connectionType === 'flow'
  const lineClass = isFlow
    ? 'connection-line flow'
    : hasEvidence ? 'connection-line has-evidence' : 'connection-line'

  // Custom style overrides
  const customStyle: React.CSSProperties = {}
  if (strokeColor) customStyle.stroke = strokeColor
  if (customStrokeWidth != null) customStyle.strokeWidth = customStrokeWidth
  if (strokeDash && strokeDash !== 'solid') {
    const dashMap: Record<string, string> = { dashed: '8 4', dotted: '2 4', 'dash-dot': '8 4 2 4' }
    customStyle.strokeDasharray = dashMap[strokeDash]
  }

  // Resolve marker
  function resolveMarker(): string {
    const style = arrowStyle ?? 'standard'
    if (style === 'none') return ''
    if (style === 'standard') {
      if (strokeColor) return `url(#arrowhead-custom-${CSS.escape(strokeColor)})`
      return isFlow ? 'url(#arrowhead-flow)' : hasEvidence ? 'url(#arrowhead-evidence)' : 'url(#arrowhead)'
    }
    const color = strokeColor || (isFlow ? '#f59e0b' : hasEvidence ? 'rgba(37, 96, 149, 0.65)' : 'rgba(37, 96, 149, 0.45)')
    return `url(#arrowhead-${style}-${CSS.escape(color)})`
  }
  const marker = resolveMarker()

  if (gapProgress < 0.001) {
    // Shorten line so it ends at arrowhead base (refX=0).
    // Arrowhead extends forward from line endpoint to original target (node edge).
    // Marker size: 8 markerUnits × strokeWidth(2) = 16px (flow: 8×3 = 24px)
    const effStrokeWidth = customStrokeWidth ?? (isFlow ? 3 : 2)
    const dxPx = (toX - fromX) * vpSize.w / 100
    const dyPx = (toY - fromY) * vpSize.h / 100
    const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
    const arrowLenPx = 8 * effStrokeWidth
    let adjToX = toX, adjToY = toY
    if (lenPx > arrowLenPx * 2) {
      const ratio = arrowLenPx / lenPx
      adjToX = toX - (toX - fromX) * ratio
      adjToY = toY - (toY - fromY) * ratio
    }
    return (
      <>
        <line
          x1={`${fromX}%`} y1={`${fromY}%`}
          x2={`${adjToX}%`} y2={`${adjToY}%`}
          className={lineClass}
          markerEnd={marker || undefined}
          style={customStyle}
        />
        {isFlow && flowProgress != null && flowProgress > 0 && (
          <line
            x1={`${fromX}%`} y1={`${fromY}%`}
            x2={`${adjToX}%`} y2={`${adjToY}%`}
            className="connection-line flow-anim"
            strokeDasharray={`${lenPx}`}
            strokeDashoffset={`${lenPx * (1 - flowProgress)}`}
          />
        )}
      </>
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

  // Shorten the target end by the arrowhead length so the marker tip
  // lands at the original target (node edge) rather than overshooting.
  const arrowLenPx = 16
  let adjTxPx = txPx, adjTyPx = tyPx
  if (lenPx > arrowLenPx * 2) {
    adjTxPx = txPx - alongX * arrowLenPx
    adjTyPx = tyPx - alongY * arrowLenPx
  }

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
      { x: adjTxPx, y: adjTyPx },
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
    return `M ${fxPx} ${fyPx} L ${sAx} ${sAy} Q ${cpx} ${cpy} ${sBx} ${sBy} L ${adjTxPx} ${adjTyPx}`
  }

  const hasPopup = popupSize && popupSize.w > 0 && popupSize.h > 0
  const d1 = hasPopup ? buildTrackForPopup(+1) : buildFallbackTrack(+1)
  const d2 = hasPopup ? buildTrackForPopup(-1) : buildFallbackTrack(-1)

  return (
    <>
      <path d={d1} className={lineClass} fill="none" markerEnd={marker || undefined} style={customStyle} />
      <path d={d2} className={lineClass} fill="none" style={customStyle} />
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
  isFlowActive,
  isFlowRunning,
  onFinishEditing,
  onLiveEditLabel,
  onResize,
  defaultCellColor,
  defaultMembraneColor,
  onSetMedia,
  onToggleCollapse,
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
  isFlowActive: boolean
  isFlowRunning: boolean
  onFinishEditing: (label: string) => void
  onLiveEditLabel: (label: string) => void
  onResize: (size: { w: number; h: number }) => void
  defaultCellColor: string
  defaultMembraneColor: string
  onSetMedia?: (mediaSrc: string, mediaFileName: string) => void
  onToggleCollapse?: () => void
  onToggleCollapse?: () => void
}) {
  const labelRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const finishedRef = useRef(false)
  const [baseSize, setBaseSize] = useState({ w: NODE_MIN_W, h: NODE_MIN_H })

  // Audio recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const onSetMediaRef = useRef(onSetMedia)
  onSetMediaRef.current = onSetMedia

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const reader = new FileReader()
        reader.onload = () => {
          if (reader.result && onSetMediaRef.current) {
            onSetMediaRef.current(reader.result as string, 'recording.webm')
          }
        }
        reader.readAsDataURL(blob)
        setIsRecording(false)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      // Microphone access denied or unavailable
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

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

  // Override base size with custom nodeWidth/nodeHeight if specified
  const effectiveBase = {
    w: node.nodeWidth ?? baseSize.w,
    h: node.nodeHeight ?? baseSize.h,
  }

  // Report measured size to parent for anchor computation
  useEffect(() => {
    onResize(effectiveBase)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBase.w, effectiveBase.h])

  const targetW = vpSize.w / CAMERA_SCALE_FINAL
  const targetH = vpSize.h / CAMERA_SCALE_FINAL

  let nodeW = effectiveBase.w + (targetW - effectiveBase.w) * progress
  let nodeH = effectiveBase.h + (targetH - effectiveBase.h) * progress

  const shape = node.shape ?? 'rounded-rect'

  // Circle enforces equal dimensions
  if (shape === 'circle' && progress === 0) {
    const maxDim = Math.max(nodeW, nodeH)
    nodeW = maxDim
    nodeH = maxDim
  }

  const chromeFade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1

  // Node style properties with theme-aware defaults
  const cellColor = node.cellColor ?? defaultCellColor
  const membraneColor = node.membraneColor ?? defaultMembraneColor
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
    minWidth: shape === 'circle' ? nodeW : effectiveBase.w,
    height: nodeH,
    minHeight: shape === 'circle' ? nodeH : effectiveBase.h,
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
      ? `drop-shadow(${shadow})${isSelected ? ' drop-shadow(0 0 8px var(--ug-flow-glow)) drop-shadow(0 0 16px var(--ug-flow-glow))' : ''}`
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

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  // Apply playStart whenever it changes or the media element mounts
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    if (node.playStart != null) {
      el.currentTime = node.playStart
    }
  }, [node.playStart, node.mediaSrc])

  const handleMediaTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) => {
    const el = e.currentTarget
    if (node.playEnd != null && el.currentTime >= node.playEnd) {
      el.pause()
      el.currentTime = node.playStart ?? 0
    }
  }, [node.playEnd, node.playStart])

  const articleContent = (
    <>
      {/* Media content for media node types */}
      {node.mediaType && node.mediaSrc && chromeFade > 0.01 && (
        <div className="media-node-content" style={{ opacity: chromeFade }}>
          {node.mediaType === 'image' && (
            <img src={node.mediaSrc} alt={node.label || 'Image'} draggable={false} />
          )}
          {node.mediaType === 'gif' && (
            <img src={node.mediaSrc} alt={node.label || 'GIF'} draggable={false} />
          )}
          {node.mediaType === 'audio' && (
            <div className="media-audio-wrapper">
              {node.audioCoverSrc && (
                <img src={node.audioCoverSrc} alt="Cover" className="media-audio-cover" draggable={false} />
              )}
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={node.mediaSrc}
                controls={!isFlowRunning}
                preload="metadata"
                onTimeUpdate={handleMediaTimeUpdate}
                onPointerDown={(e) => e.stopPropagation()}
                className={isFlowRunning ? 'flow-hidden-media' : undefined}
              />
            </div>
          )}
          {node.mediaType === 'video' && (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={node.mediaSrc}
              controls={!isFlowRunning}
              preload="metadata"
              draggable={false}
              onTimeUpdate={handleMediaTimeUpdate}
              onPointerDown={(e) => {
                // Only block left-click in the native controls bar (~40px from bottom)
                // so node dragging and connection drawing still work on the video surface
                if (e.button === 0) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const yInElement = e.clientY - rect.top
                  if (yInElement > rect.height - 40) {
                    e.stopPropagation()
                  }
                }
              }}
            />
          )}
        </div>
      )}
      {/* Markdown / Math content */}
      {(node.mediaType === 'markdown' || node.mediaType === 'math') && chromeFade > 0.01 && (
        <div className="content-node-wrapper" style={{ opacity: chromeFade, fontSize: `${node.contentFontSize ?? 0.85}rem` }}>
          <div
            className="content-node-chevron"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.() }}
          >
            {node.contentCollapsed !== false ? '▸' : '▾'}
          </div>
          {node.contentCollapsed !== false ? (
            <div className="content-node-preview">
              {node.contentSource
                ? (node.mediaType === 'math'
                  ? (() => { try { return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(node.contentSource.split('\n')[0], { throwOnError: false }) }} /> } catch { return <span className="content-node-fallback">{node.contentSource.split('\n')[0]}</span> } })()
                  : <span>{node.contentSource.split('\n')[0].slice(0, 60)}{node.contentSource.split('\n')[0].length > 60 ? '…' : ''}</span>)
                : <span className="content-node-empty">{node.mediaType === 'markdown' ? 'Empty markdown' : 'Empty formula'}</span>}
            </div>
          ) : (
            <div
              className={`content-node-body content-node-${node.mediaType}`}
              dangerouslySetInnerHTML={{
                __html: node.contentSource
                  ? (node.mediaType === 'markdown'
                    ? DOMPurify.sanitize(marked.parse(node.contentSource) as string)
                    : (() => { try { return katex.renderToString(node.contentSource!, { throwOnError: false, displayMode: true }) } catch { return `<span class="content-node-fallback">${node.contentSource}</span>` } })())
                  : `<span class="content-node-empty">${node.mediaType === 'markdown' ? 'Empty markdown' : 'Empty formula'}</span>`,
              }}
            />
          )}
        </div>
      )}
      {/* Empty media placeholder (or audio with cover but no audio yet) */}
      {node.mediaType && node.mediaType !== 'markdown' && node.mediaType !== 'math' && !node.mediaSrc && chromeFade > 0.01 && (
        <div className="media-node-placeholder" style={{ opacity: chromeFade }}>
          {node.mediaType === 'audio' && node.audioCoverSrc ? (
            <img src={node.audioCoverSrc} alt="Cover" className="media-audio-cover" draggable={false}
              style={{ maxHeight: '60%', objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <span className="media-node-placeholder-icon">
              {node.mediaType === 'image' ? '🖼' : node.mediaType === 'gif' ? '🎞' : node.mediaType === 'audio' ? (isRecording ? '⏺' : '🔊') : '🎬'}
            </span>
          )}
          <span className="media-node-placeholder-text">
            {isRecording ? 'Recording…' : node.mediaType === 'audio' && node.audioCoverSrc ? 'Drop audio or record' : `Drop ${node.mediaType} here`}
          </span>
          {node.mediaType === 'audio' && onSetMedia && (
            <button
              className="media-record-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); isRecording ? stopRecording() : startRecording() }}
            >
              {isRecording ? '⏹ Stop' : '⏺ Record'}
            </button>
          )}
        </div>
      )}
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
          style={{
            opacity: chromeFade,
            visibility: chromeFade > 0.01 ? 'visible' : 'hidden',
            ...((node.mediaType === 'markdown' || node.mediaType === 'math') && node.contentSource ? { display: 'none' } : {}),
          }}
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
      {isZooming && childModel && (() => {
        const childCosmetics = useHybridZoomStore.getState().modelCosmetics[childModel.id]
        const childBg = childCosmetics?.background
        const childBgStyle = childBg ? resolveBackground(childBg) : undefined
        return (
          <div className="child-model" style={childBg?.type !== 'image' ? childBgStyle : undefined}>
            {childBg?.type === 'image' && childBg.value && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 0,
                  backgroundImage: `url(${childBg.value})`,
                  backgroundSize: childBg.fit === 'tile' ? 'auto' : (childBg.fit ?? 'cover'),
                  backgroundPosition: 'center',
                  backgroundRepeat: childBg.fit === 'tile' ? 'repeat' : 'no-repeat',
                  opacity: childBg.opacity ?? 1,
                  filter: childBg.blur ? `blur(${childBg.blur}px)` : undefined,
                  pointerEvents: 'none',
                }}
              />
            )}
            {/* Particles omitted in mini-view — PixiJS can't reliably resize inside an animating container.
                Full particle effect activates after RMM handoff. */}
            <ChildModelPreview
              model={childModel}
              scale={nodeW / vpSize.w}
              vpSize={vpSize}
            />
          </div>
        )
      })()}
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
          className={`host-node${isSelected ? ' focused' : ''}${isFlowActive ? ' flow-active' : ''}`}
          data-node-id={node.id}
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
      className={`host-node${isSelected ? ' focused' : ''}${isMultiSelected ? ' multi-selected' : ''}${isFlowActive ? ' flow-active' : ''}`}
      data-node-id={node.id}
      style={{ ...positionStyle, ...vizStyle }}
      {...articleEventHandlers}
    >
      {articleContent}
    </article>
  )
}

/** Preview of child model content inside a node canvas */
function ChildModelPreview({ model, scale, vpSize }: { model: Model; scale: number; vpSize: { w: number; h: number } }) {
  const appThemeMode = useHybridZoomStore((s) => s.appThemeMode)
  const palette = resolvePalette(appThemeMode)
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

        const cellColor = node.cellColor ?? palette.nodeCell
        const memColor = node.membraneColor ?? palette.nodeMembrane
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
