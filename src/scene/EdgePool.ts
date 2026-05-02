/**
 * Pooled `Graphics` per visible edge. Stage 3 edges are straight lines from
 * source-boundary to target-boundary with an arrow head at the target end.
 *
 * Endpoints are computed by projecting the line direction against each
 * node's shape via `shapeEdgeIntersect`, which keeps the arrow head from
 * sinking into the node body. The legacy renderer relied on the same trick
 * (see `src/old/scene/edgeAnchoring.ts`).
 */

import { Container, Graphics } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import type { Connection, ModelNode } from '../model/types'
import { shapeEdgeIntersect } from './shapeIntersect'

interface PooledEdge {
  gfx: Graphics
  dirtyKey: string
}

const keyOf = (
  e: Connection,
  from: ModelNode,
  to: ModelNode,
): string =>
  `${from.x},${from.y},${from.w},${from.h},${from.shape}|${to.x},${to.y},${to.w},${to.h},${to.shape}|${e.color}|${e.width}`

/** Visual size of the arrow head, in scene pixels. */
const ARROW_LEN = 16
const ARROW_HALF_W = 7

function drawEdge(g: Graphics, e: Connection, from: ModelNode, to: ModelNode): void {
  g.clear()
  const fxC = (from.x / 100) * SCENE_W
  const fyC = (from.y / 100) * SCENE_H
  const txC = (to.x / 100) * SCENE_W
  const tyC = (to.y / 100) * SCENE_H
  const dx = txC - fxC
  const dy = tyC - fyC
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return

  // Project endpoints onto each node's shape boundary so the line emerges
  // from the outline rather than the centre. Direction is the *outgoing*
  // ray for each side, so the target side gets the reversed direction.
  const fHw = ((from.w / 100) * SCENE_W) / 2
  const fHh = ((from.h / 100) * SCENE_H) / 2
  const tHw = ((to.w / 100) * SCENE_W) / 2
  const tHh = ((to.h / 100) * SCENE_H) / 2
  const fEdge = shapeEdgeIntersect(from.shape, fHw, fHh, dx, dy)
  const tEdge = shapeEdgeIntersect(to.shape, tHw, tHh, -dx, -dy)
  const fx = fxC + fEdge.x
  const fy = fyC + fEdge.y
  const tx = txC + tEdge.x
  const ty = tyC + tEdge.y

  const strokePx = Math.max(1, (e.width / 100) * SCENE_W)
  const ndx = tx - fx
  const ndy = ty - fy
  const segLen = Math.hypot(ndx, ndy)
  if (segLen < 1e-3) return
  const ux = ndx / segLen
  const uy = ndy / segLen
  // Pull the line short of the arrow tip so the stroke doesn't overshoot
  // through the chevron filling.
  const lineEndX = tx - ux * (ARROW_LEN * 0.6)
  const lineEndY = ty - uy * (ARROW_LEN * 0.6)
  g.moveTo(fx, fy).lineTo(lineEndX, lineEndY)
  g.stroke({ color: e.color, width: strokePx, alignment: 0.5 })

  // Filled triangle arrow head at the target boundary point.
  const baseX = tx - ux * ARROW_LEN
  const baseY = ty - uy * ARROW_LEN
  const px = -uy
  const py = ux
  g.poly([
    tx, ty,
    baseX + px * ARROW_HALF_W, baseY + py * ARROW_HALF_W,
    baseX - px * ARROW_HALF_W, baseY - py * ARROW_HALF_W,
  ])
  g.fill({ color: e.color })
}

export class EdgePool {
  private active = new Map<string, PooledEdge>()
  private free: PooledEdge[] = []
  private readonly layer: Container

  constructor(layer: Container) {
    this.layer = layer
  }

  get activeCount(): number {
    return this.active.size
  }

  has(id: string): boolean {
    return this.active.has(id)
  }

  acquire(e: Connection, from: ModelNode, to: ModelNode): void {
    let pe = this.active.get(e.id)
    if (!pe) {
      pe = this.free.pop() ?? { gfx: new Graphics(), dirtyKey: '' }
      pe.gfx.eventMode = 'none'
      this.layer.addChild(pe.gfx)
      pe.dirtyKey = ''
      this.active.set(e.id, pe)
    }
    this.update(e, from, to)
  }

  update(e: Connection, from: ModelNode, to: ModelNode): void {
    const pe = this.active.get(e.id)
    if (!pe) return
    const key = keyOf(e, from, to)
    if (key === pe.dirtyKey) return
    drawEdge(pe.gfx, e, from, to)
    pe.dirtyKey = key
  }

  release(id: string): void {
    const pe = this.active.get(id)
    if (!pe) return
    this.active.delete(id)
    this.layer.removeChild(pe.gfx)
    this.free.push(pe)
  }

  releaseAll(): void {
    for (const id of [...this.active.keys()]) this.release(id)
  }

  forEachVisible(cb: (id: string) => void): void {
    for (const id of this.active.keys()) cb(id)
  }

  destroy(): void {
    this.releaseAll()
    for (const pe of this.free) pe.gfx.destroy()
    this.free.length = 0
  }
}
