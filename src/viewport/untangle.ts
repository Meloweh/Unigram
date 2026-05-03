/**
 * Auto-untangle: a small force-directed relaxation that reduces edge
 * crossings and inter-node overlap. Ported in spirit from the legacy
 * `src/old/viewport/autoUntangle.ts` Phase-3 force pass — kept simple so
 * it ships in stage 4 without a worker. Runs synchronously in a few
 * milliseconds for ≤500 nodes; locked nodes never move.
 *
 * Coords are scene-percent (0–100). The forces themselves are computed in
 * scene-pixel space (so aspect ratio isn't squashed) and converted back
 * before returning.
 */

import { SCENE_W, SCENE_H } from '../scene/sceneConstants'
import type { Connection, ModelNode } from '../model/types'

/**
 * Compute new positions that reduce crossings + overlaps. Returns a map
 * `nodeId → { x, y }` in scene-percent coords. Locked nodes are present
 * with their original positions so the caller can dispatch the whole map
 * unconditionally.
 */
export function computeUntangledPositions(
  nodes: Iterable<ModelNode>,
  edges: Iterable<Connection>,
): Map<string, { x: number; y: number }> {
  const ns = [...nodes]
  const es = [...edges]
  // Working positions in scene-pixel space; aspect-correct geometry.
  const pos = new Map<string, { x: number; y: number; locked: boolean; rW: number; rH: number }>()
  for (const n of ns) {
    pos.set(n.id, {
      x: ((n.x + n.w / 2) / 100) * SCENE_W,
      y: ((n.y + n.h / 2) / 100) * SCENE_H,
      locked: !!n.locked,
      rW: Math.max(8, (n.w / 100) * SCENE_W),
      rH: Math.max(8, (n.h / 100) * SCENE_H),
    })
  }

  const ITERS = 140
  const MARGIN = 30 // pixels of breathing room beyond bbox half-extent
  // Boundary keeps nodes inside a 4–96% safe zone so they don't crash into
  // the edge of the virtual canvas.
  const minX = 0.04 * SCENE_W
  const maxX = 0.96 * SCENE_W
  const minY = 0.04 * SCENE_H
  const maxY = 0.96 * SCENE_H

  for (let iter = 0; iter < ITERS; iter++) {
    const t = 1 - iter / ITERS
    const step = 4.5 * t

    const fx = new Map<string, number>()
    const fy = new Map<string, number>()
    for (const n of ns) {
      fx.set(n.id, 0)
      fy.set(n.id, 0)
    }

    // Repulsion: push every node pair apart with strength inversely
    // proportional to distance. Soft-clamp to avoid divide-by-zero.
    for (let i = 0; i < ns.length; i++) {
      const a = pos.get(ns[i].id)!
      for (let j = i + 1; j < ns.length; j++) {
        const b = pos.get(ns[j].id)!
        const dx = a.x - b.x
        const dy = a.y - b.y
        const minDist = (a.rW + b.rW) / 2 + (a.rH + b.rH) / 2 + MARGIN
        const dist = Math.max(0.5, Math.hypot(dx, dy))
        const strength = (minDist * minDist) / (dist * dist)
        const ux = dx / dist
        const uy = dy / dist
        if (!a.locked) {
          fx.set(ns[i].id, fx.get(ns[i].id)! + ux * strength)
          fy.set(ns[i].id, fy.get(ns[i].id)! + uy * strength)
        }
        if (!b.locked) {
          fx.set(ns[j].id, fx.get(ns[j].id)! - ux * strength)
          fy.set(ns[j].id, fy.get(ns[j].id)! - uy * strength)
        }
      }
    }

    // Attraction along edges: pull connected nodes toward an ideal
    // length. Hooke-style spring (linear with separation).
    const ideal = 0.1 * SCENE_W
    for (const e of es) {
      const a = pos.get(e.from)
      const b = pos.get(e.to)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(0.5, Math.hypot(dx, dy))
      const k = (dist - ideal) * 0.05
      const ux = dx / dist
      const uy = dy / dist
      if (!a.locked) {
        fx.set(e.from, fx.get(e.from)! + ux * k)
        fy.set(e.from, fy.get(e.from)! + uy * k)
      }
      if (!b.locked) {
        fx.set(e.to, fx.get(e.to)! - ux * k)
        fy.set(e.to, fy.get(e.to)! - uy * k)
      }
    }

    // Apply forces with a step + temperature schedule.
    for (const n of ns) {
      const p = pos.get(n.id)!
      if (p.locked) continue
      const fxv = fx.get(n.id)!
      const fyv = fy.get(n.id)!
      const fmag = Math.hypot(fxv, fyv)
      if (fmag < 1e-3) continue
      const cap = step * 8
      const scale = Math.min(1, cap / fmag)
      p.x = Math.max(minX, Math.min(maxX, p.x + fxv * step * scale))
      p.y = Math.max(minY, Math.min(maxY, p.y + fyv * step * scale))
    }
  }

  // Convert centres back to top-left scene-percent coords.
  const out = new Map<string, { x: number; y: number }>()
  for (const n of ns) {
    const p = pos.get(n.id)!
    const xPct = (p.x / SCENE_W) * 100 - n.w / 2
    const yPct = (p.y / SCENE_H) * 100 - n.h / 2
    out.set(n.id, { x: xPct, y: yPct })
  }
  return out
}
