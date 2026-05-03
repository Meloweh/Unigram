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
import { DEFAULT_NODE, type ModelNode } from '../model/types'
import type { NodeOverride } from '../flow/types'
import { drawNodeShape } from './shapes'
import {
  NODE_FONT_FAMILY,
  NODE_FONT_SIZE,
  NODE_LABEL_FILL,
  NODE_MIN_H,
  NODE_MIN_W,
  NODE_STROKE_WIDTH,
  nodeFillGradient,
} from './nodeStyle'

/** LOD presented to the pool when a node becomes (re)visible. */
export type Lod = 'full' | 'simple' | 'dot'

/**
 * Theme-driven defaults that override `DEFAULT_NODE`-coloured nodes when
 * the user has not explicitly customised that node's colours. Set by the
 * renderer via {@link NodePool.setThemePalette}; null means "use the raw
 * `cellColor` / `membraneColor` exactly as stored on the node".
 */
export interface ThemeColors {
  cell: string
  membrane: string
  label: number
}

/**
 * Return the cell colour to draw with: if the node still carries the
 * factory default colour and a theme override is active, swap in the
 * palette colour so dark / sepia / contrast modes recolour the canvas.
 * Otherwise the user explicitly chose this colour — leave it alone.
 */
function effectiveCellColor(n: ModelNode, theme: ThemeColors | null): string {
  if (theme && n.cellColor === DEFAULT_NODE.cellColor) return theme.cell
  return n.cellColor
}
function effectiveMembraneColor(n: ModelNode, theme: ThemeColors | null): string {
  if (theme && n.membraneColor === DEFAULT_NODE.membraneColor) return theme.membrane
  return n.membraneColor
}

interface PooledNode {
  container: Container
  shape: Graphics
  label: Text
  /** Cheap dirty key to skip Graphics rebuilds on no-op updates. */
  dirtyKey: string
  lod: Lod
}

/** Fraction of node interior available for label text after shape inset. */
const TEXT_INSET = 0.82
/** Extra scene-percent padding around the text bounding box. */
const TEXT_PAD_PCT = 1.0

const dirtyKeyOf = (n: ModelNode, lod: Lod, theme: ThemeColors | null): string =>
  `${lod}|${n.shape}|${n.w}|${n.h}|${effectiveCellColor(n, theme)}|${effectiveMembraneColor(n, theme)}|${n.tip?.x ?? 0}|${n.tip?.y ?? 0}|${n.label}`

const labelKeyOf = (n: ModelNode, lod: Lod): string => (lod === 'full' ? n.label : '')

function drawShape(g: Graphics, n: ModelNode, lod: Lod, theme: ThemeColors | null): void {
  g.clear()
  const cell = effectiveCellColor(n, theme)
  const membrane = effectiveMembraneColor(n, theme)
  if (lod === 'dot') {
    g.rect(-2, -2, 4, 4).fill({ color: cell })
    return
  }
  // Convert percent → pixels using SCENE_W/H for stable proportions.
  const wPx = (n.w / 100) * SCENE_W
  const hPx = (n.h / 100) * SCENE_H
  const tip = n.tip
    ? { x: (n.tip.x / 100) * SCENE_W, y: (n.tip.y / 100) * SCENE_H }
    : undefined
  // `simple` LOD draws a flat fill (cheap); `full` uses the cached gradient
  // for the legacy 145° cell→darker look.
  const fill = lod === 'simple' ? cell : nodeFillGradient(cell)
  drawNodeShape(g, n.shape, {
    w: wPx,
    h: hPx,
    fill,
    stroke: membrane,
    strokeWidth: NODE_STROKE_WIDTH,
    tip,
  })
}

function setLabel(t: Text, n: ModelNode, lod: Lod): void {
  const text = labelKeyOf(n, lod)
  if (t.text !== text) t.text = text
  t.visible = text.length > 0
}

export type NodeFitCallback = (id: string, w: number, h: number) => void

export class NodePool {
  private active = new Map<string, PooledNode>()
  private free: PooledNode[] = []
  private readonly layer: Container
  /** Optional hook the renderer registers to grow the node + quadtree entry. */
  onNodeFit?: NodeFitCallback
  /**
   * Active theme override. When set, nodes that still carry the factory
   * default colours render with the palette colours instead so the canvas
   * follows light/dark/sepia/contrast mode. Per-node user-chosen colours
   * are never overridden.
   */
  private theme: ThemeColors | null = null

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
  acquire(n: ModelNode, lod: Lod, override?: NodeOverride): void {
    let pn = this.active.get(n.id)
    if (!pn) {
      pn = this.free.pop() ?? this.createNew()
      this.layer.addChild(pn.container)
      pn.dirtyKey = '' // force redraw
      this.active.set(n.id, pn)
    }
    this.update(n, lod, override)
  }

  /** Update an already-visible node. No-op if nothing visual changed. */
  update(n: ModelNode, lod: Lod, override?: NodeOverride): void {
    const pn = this.active.get(n.id)
    if (!pn) return
    const baseX = (n.x / 100) * SCENE_W
    const baseY = (n.y / 100) * SCENE_H
    if (override) {
      pn.container.x = baseX + ((override.dx ?? 0) / 100) * SCENE_W
      pn.container.y = baseY + ((override.dy ?? 0) / 100) * SCENE_H
      const s = override.scaleMul ?? 1
      pn.container.scale.set(s, s)
      pn.container.alpha = override.alphaMul ?? 1
      pn.container.tint = override.tint ?? 0xffffff
    } else {
      pn.container.x = baseX
      pn.container.y = baseY
      if (pn.container.scale.x !== 1) pn.container.scale.set(1, 1)
      if (pn.container.alpha !== 1) pn.container.alpha = 1
      if (pn.container.tint !== 0xffffff) pn.container.tint = 0xffffff
    }
    const key = dirtyKeyOf(n, lod, this.theme)
    if (key !== pn.dirtyKey) {
      drawShape(pn.shape, n, lod, this.theme)
      setLabel(pn.label, n, lod)
      pn.dirtyKey = key
      pn.lod = lod
      // Auto-grow the node to fit its label. Only grows; never shrinks (so
      // a user-resized node sticks). The renderer hook updates the model +
      // quadtree on our behalf. Floor the result at NODE_MIN_W/H to match
      // the legacy minimum chrome size.
      if (lod === 'full' && this.onNodeFit && pn.label.visible) {
        const labelWPx = pn.label.width
        const labelHPx = pn.label.height
        const requiredW = Math.max(
          NODE_MIN_W,
          (labelWPx / TEXT_INSET / SCENE_W) * 100 + TEXT_PAD_PCT,
        )
        const requiredH = Math.max(
          NODE_MIN_H,
          (labelHPx / TEXT_INSET / SCENE_H) * 100 + TEXT_PAD_PCT,
        )
        if (requiredW > n.w + 0.01 || requiredH > n.h + 0.01) {
          this.onNodeFit(n.id, Math.max(n.w, requiredW), Math.max(n.h, requiredH))
        }
      }
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

  /**
   * Set or clear the theme override. Invalidates every active node's dirty
   * key and updates label tints so the next draw recolours the canvas.
   * Cheap (O(active)); palette changes are user-driven, not per frame.
   */
  setThemePalette(theme: ThemeColors | null): void {
    this.theme = theme
    for (const pn of this.active.values()) {
      pn.dirtyKey = ''
      pn.label.style.fill = theme?.label ?? NODE_LABEL_FILL
    }
    for (const pn of this.free) {
      pn.label.style.fill = theme?.label ?? NODE_LABEL_FILL
    }
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
        fontFamily: NODE_FONT_FAMILY,
        fontSize: NODE_FONT_SIZE,
        fill: NODE_LABEL_FILL,
        align: 'center',
      },
    })
    label.anchor.set(0.5)
    label.visible = false
    container.addChild(label)
    return { container, shape, label, dirtyKey: '', lod: 'full' }
  }
}
