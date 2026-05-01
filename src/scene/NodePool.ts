/**
 * Pooled Pixi `Container`s for nodes. One container per visible node, reused
 * across frames. Acquire/release are O(1) and produce zero garbage on the
 * steady-state hot path.
 *
 * The pool only knows about scene-graph entities. Coordinate translation,
 * culling, and store mediation happen one layer up in `SceneRenderer`.
 */

import { Container, Graphics, Text } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import type { ModelNode } from '../model/types'

/** LOD presented to the pool when a node becomes (re)visible. */
export type Lod = 'full' | 'simple' | 'dot'

interface PooledNode {
  container: Container
  shape: Graphics
  label: Text
  /** Cheap dirty key to skip Graphics rebuilds on no-op updates. */
  dirtyKey: string
  lod: Lod
}

const dirtyKeyOf = (n: ModelNode, lod: Lod): string =>
  `${lod}|${n.shape}|${n.w}|${n.h}|${n.cellColor}|${n.membraneColor}`

const labelKeyOf = (n: ModelNode, lod: Lod): string => (lod === 'full' ? n.label : '')

function drawShape(g: Graphics, n: ModelNode, lod: Lod): void {
  g.clear()
  if (lod === 'dot') {
    g.rect(-2, -2, 4, 4).fill({ color: n.cellColor })
    return
  }
  // Convert percent → pixels using SCENE_W/H for stable proportions.
  const wPx = (n.w / 100) * SCENE_W
  const hPx = (n.h / 100) * SCENE_H
  switch (n.shape) {
    case 'circle': {
      const r = Math.min(wPx, hPx) / 2
      g.circle(0, 0, r)
      break
    }
    case 'rectangle':
      g.rect(-wPx / 2, -hPx / 2, wPx, hPx)
      break
    case 'rounded-rect':
    default:
      g.roundRect(-wPx / 2, -hPx / 2, wPx, hPx, Math.min(wPx, hPx) * 0.18)
      break
  }
  g.fill({ color: n.cellColor })
  g.stroke({ color: n.membraneColor, width: 2, alignment: 0.5 })
}

function setLabel(t: Text, n: ModelNode, lod: Lod): void {
  const text = labelKeyOf(n, lod)
  if (t.text !== text) t.text = text
  t.visible = text.length > 0
}

export class NodePool {
  private active = new Map<string, PooledNode>()
  private free: PooledNode[] = []
  private readonly layer: Container

  constructor(layer: Container) {
    this.layer = layer
  }

  /** Number of currently-visible (active) nodes. */
  get activeCount(): number {
    return this.active.size
  }

  has(id: string): boolean {
    return this.active.has(id)
  }

  /** Make a node visible; create or recycle a container as needed. */
  acquire(n: ModelNode, lod: Lod): void {
    let pn = this.active.get(n.id)
    if (!pn) {
      pn = this.free.pop() ?? this.createNew()
      this.layer.addChild(pn.container)
      pn.dirtyKey = '' // force redraw
      this.active.set(n.id, pn)
    }
    this.update(n, lod)
  }

  /** Update an already-visible node. No-op if nothing visual changed. */
  update(n: ModelNode, lod: Lod): void {
    const pn = this.active.get(n.id)
    if (!pn) return
    pn.container.x = (n.x / 100) * SCENE_W
    pn.container.y = (n.y / 100) * SCENE_H
    const key = dirtyKeyOf(n, lod)
    if (key !== pn.dirtyKey) {
      drawShape(pn.shape, n, lod)
      setLabel(pn.label, n, lod)
      pn.dirtyKey = key
      pn.lod = lod
    } else {
      // Label text can change while shape stays stable.
      setLabel(pn.label, n, lod)
    }
  }

  /** Hide a node, returning its container to the free list. */
  release(id: string): void {
    const pn = this.active.get(id)
    if (!pn) return
    this.active.delete(id)
    this.layer.removeChild(pn.container)
    this.free.push(pn)
  }

  /** Hide every active node; useful on model swap. */
  releaseAll(): void {
    for (const id of [...this.active.keys()]) this.release(id)
  }

  /** Currently visible ids (for diffing). */
  forEachVisible(cb: (id: string) => void): void {
    for (const id of this.active.keys()) cb(id)
  }

  destroy(): void {
    this.releaseAll()
    for (const pn of this.free) pn.container.destroy({ children: true })
    this.free.length = 0
  }

  private createNew(): PooledNode {
    const container = new Container()
    container.eventMode = 'none'
    const shape = new Graphics()
    container.addChild(shape)
    const label = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: 36,
        fill: 0x223046,
        align: 'center',
      },
    })
    label.anchor.set(0.5)
    label.visible = false
    container.addChild(label)
    return { container, shape, label, dirtyKey: '', lod: 'full' }
  }
}
