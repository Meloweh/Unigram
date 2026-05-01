/**
 * Pooled `Graphics` per visible edge. Stage-1 edges are straight lines from
 * source-center to target-center. Edge anchoring and curves arrive in stage 3.
 */

import { Container, Graphics } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import type { Connection, ModelNode } from '../model/types'

interface PooledEdge {
  gfx: Graphics
  dirtyKey: string
}

const keyOf = (
  e: Connection,
  from: ModelNode,
  to: ModelNode,
): string =>
  `${from.x},${from.y}|${to.x},${to.y}|${e.color}|${e.width}`

function drawEdge(g: Graphics, e: Connection, from: ModelNode, to: ModelNode): void {
  g.clear()
  const fx = (from.x / 100) * SCENE_W
  const fy = (from.y / 100) * SCENE_H
  const tx = (to.x / 100) * SCENE_W
  const ty = (to.y / 100) * SCENE_H
  g.moveTo(fx, fy).lineTo(tx, ty)
  g.stroke({ color: e.color, width: Math.max(1, (e.width / 100) * SCENE_W), alignment: 0.5 })
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
