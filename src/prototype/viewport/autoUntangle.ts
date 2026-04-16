import type { ModelNode, ModelConnection } from '../model/sampleModels'
import { DEFAULT_GRID_SNAP, snapToGrid } from '../model/useHybridZoomStore'
import { countCrossings, segmentsIntersect, segmentIntersectsRect, estimateNodePx } from '../scene/edgeAnchoring'

/**
 * Compute untangled target positions.
 * Phase 1: targeted endpoint displacement — for each crossing, try nudging
 *          each of the 4 involved endpoints across the opposing edge.
 * Phase 2: greedy node-pair swaps as fallback for crossings Phase 1 can't resolve.
 * Phase 3: force refinement to clean up spacing.
 * Returns a map from nodeId to {x, y} in percentage coords, or null if already untangled.
 */
export function computeUntangledPositions(
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
