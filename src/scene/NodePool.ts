/**
 * Pooled Pixi `Container`s for nodes. One container per visible node, reused
 * across frames. Acquire/release are O(1) and produce zero garbage on the
 * steady-state hot path.
 *
 * The pool only knows about scene-graph entities. Coordinate translation,
 * culling, and store mediation happen one layer up in `SceneRenderer`.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
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
  media?: PooledMedia
  breaking?: PooledBreakApart
  wasBreakingApart: boolean
  mediaPreviewActive: boolean
  breakDirtyKey: string
  breakMaskKey: string
  breakLabelKey: string
  breakStateKey: string
  /** Cheap dirty key to skip Graphics rebuilds on no-op updates. */
  dirtyKey: string
  lod: Lod
}

interface PooledMedia {
  bg: Graphics
  sprite: Sprite
  text: Text
}

interface PooledBreakApart {
  container: Container
  a: Container
  aShape: Graphics
  aLabel: Text
  aMask: Graphics
  b: Container
  bShape: Graphics
  bLabel: Text
  bMask: Graphics
}

interface BreakApartState {
  axis: NonNullable<NodeOverride['breakApart']>['axis']
  fallRatio: number
  shakeX: number
  shakeY: number
}

interface MediaPreviewState {
  active: boolean
  spriteSrc: string
  text: string
  innerW: number
  innerH: number
  alpha: number
  fontSize: number
}

/** Fraction of node interior available for label text after shape inset. */
const TEXT_INSET = 0.82
/** Extra scene-percent padding around the text bounding box. */
const TEXT_PAD_PCT = 1.0

const dirtyKeyOf = (n: ModelNode, lod: Lod, theme: ThemeColors | null): string =>
  `${lod}|${n.shape}|${n.w}|${n.h}|${effectiveCellColor(n, theme)}|${effectiveMembraneColor(n, theme)}|${n.tip?.x ?? 0}|${n.tip?.y ?? 0}|${n.label}|${n.mediaType ?? ''}|${n.mediaSrc ?? ''}|${n.audioCoverSrc ?? ''}|${n.mediaFileName ?? ''}|${n.contentSource ?? ''}|${n.contentCollapsed ?? ''}|${n.contentFontSize ?? ''}`

const labelKeyOf = (n: ModelNode, lod: Lod): string => (lod === 'full' && !n.mediaType ? n.label : '')

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

function drawBreakShape(g: Graphics, n: ModelNode, theme: ThemeColors | null): void {
  drawShape(g, n, 'full', theme)
}

function setLabel(t: Text, n: ModelNode, lod: Lod): void {
  const text = labelKeyOf(n, lod)
  if (t.text !== text) t.text = text
  t.visible = text.length > 0
}

function mediaPreviewState(n: ModelNode, lod: Lod): MediaPreviewState {
  const active = lod === 'full' && !!n.mediaType
  if (!active) {
    return { active: false, spriteSrc: '', text: '', innerW: 0, innerH: 0, alpha: 0, fontSize: 0 }
  }

  const wPx = (n.w / 100) * SCENE_W
  const hPx = (n.h / 100) * SCENE_H
  const pad = Math.min(14, Math.max(4, Math.min(wPx, hPx) * 0.08))
  const innerW = Math.max(1, wPx - pad * 2)
  const innerH = Math.max(1, hPx - pad * 2)
  const spriteSrc = n.mediaType === 'audio' ? n.audioCoverSrc : n.mediaSrc
  const canSprite = !!spriteSrc && (n.mediaType === 'image' || n.mediaType === 'gif' || n.mediaType === 'video' || n.mediaType === 'audio')
  return {
    active: true,
    spriteSrc: canSprite ? spriteSrc : '',
    text: mediaPreviewText(n),
    innerW,
    innerH,
    alpha: n.mediaType === 'audio' ? 0.7 : 0.9,
    fontSize: Math.max(10, Math.min(18, innerH * 0.22)),
  }
}

function setMediaPreview(pn: PooledNode, n: ModelNode, lod: Lod): void {
  const state = mediaPreviewState(n, lod)
  if (!state.active && !pn.mediaPreviewActive && !pn.media) return
  const media = pn.media ?? ensureMedia(pn)
  media.bg.visible = state.active
  media.sprite.visible = false
  media.text.visible = false
  pn.mediaPreviewActive = state.active
  if (!state.active) return

  media.bg.clear()
  media.bg.roundRect(-state.innerW / 2, -state.innerH / 2, state.innerW, state.innerH, Math.min(10, state.innerH * 0.2))
    .fill({ color: 0xffffff, alpha: 0.32 })

  if (state.spriteSrc) {
    media.sprite.texture = Texture.from(state.spriteSrc)
    media.sprite.visible = true
    media.sprite.width = state.innerW
    media.sprite.height = state.innerH
    media.sprite.x = -state.innerW / 2
    media.sprite.y = -state.innerH / 2
    media.sprite.alpha = state.alpha
  }

  media.text.text = state.text
  media.text.visible = media.text.text.length > 0
  media.text.style.fontSize = state.fontSize
  media.text.x = 0
  media.text.y = 0
}

function mediaPreviewText(n: ModelNode): string {
  if (n.mediaType === 'markdown' || n.mediaType === 'math') {
    const source = n.contentSource ?? (typeof n.extra?.contentSource === 'string' ? n.extra.contentSource : '')
    if (!source) return n.mediaType === 'markdown' ? 'Empty markdown' : 'Empty formula'
    const first = source.split('\n')[0]
    return first.length > 42 ? `${first.slice(0, 42)}...` : first
  }
  if (n.mediaType === 'audio') return n.mediaFileName ? `Audio\n${n.mediaFileName}` : 'Audio'
  if (!n.mediaSrc) return `Drop ${n.mediaType ?? 'media'} here`
  if (n.mediaType === 'video') return n.mediaFileName ? `Video\n${n.mediaFileName}` : 'Video'
  return ''
}

function ensureMedia(pn: PooledNode): PooledMedia {
  if (pn.media) return pn.media
  const bg = new Graphics()
  bg.eventMode = 'none'
  bg.visible = false
  const sprite = new Sprite()
  sprite.eventMode = 'none'
  sprite.visible = false
  const text = new Text({
    text: '',
    style: {
      fontFamily: NODE_FONT_FAMILY,
      fontSize: 14,
      fill: NODE_LABEL_FILL,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 180,
    },
  })
  text.anchor.set(0.5)
  text.visible = false
  const labelIndex = pn.container.getChildIndex(pn.label)
  pn.container.addChildAt(bg, labelIndex)
  pn.container.addChildAt(sprite, labelIndex + 1)
  pn.container.addChildAt(text, labelIndex + 2)
  pn.media = { bg, sprite, text }
  return pn.media
}

function ensureBreakApart(pn: PooledNode, labelFill: number): PooledBreakApart {
  if (pn.breaking) return pn.breaking
  const container = new Container()
  container.eventMode = 'none'
  container.visible = false
  const a = new Container()
  a.eventMode = 'none'
  const aShape = new Graphics()
  const aLabel = new Text({
    text: '',
    style: { fontFamily: NODE_FONT_FAMILY, fontSize: NODE_FONT_SIZE, fill: labelFill, align: 'center' },
  })
  aLabel.anchor.set(0.5)
  const aMask = new Graphics()
  a.addChild(aShape, aLabel, aMask)
  a.mask = aMask

  const b = new Container()
  b.eventMode = 'none'
  const bShape = new Graphics()
  const bLabel = new Text({
    text: '',
    style: { fontFamily: NODE_FONT_FAMILY, fontSize: NODE_FONT_SIZE, fill: labelFill, align: 'center' },
  })
  bLabel.anchor.set(0.5)
  const bMask = new Graphics()
  b.addChild(bShape, bLabel, bMask)
  b.mask = bMask

  container.addChild(a, b)
  pn.container.addChild(container)
  pn.breaking = { container, a, aShape, aLabel, aMask, b, bShape, bLabel, bMask }
  return pn.breaking
}

const breakStateKey = (breaking: BreakApartState): string =>
  `${breaking.axis}|${breaking.fallRatio.toFixed(4)}|${breaking.shakeX.toFixed(2)}|${breaking.shakeY.toFixed(2)}`

const breakMaskKeyOf = (n: ModelNode, breaking: BreakApartState): string =>
  `${breaking.axis}|${n.w}|${n.h}`

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
    const breaking = override?.breakApart
    if (override) {
      pn.container.x = baseX + ((override.dx ?? 0) / 100) * SCENE_W
      pn.container.y = baseY + ((override.dy ?? 0) / 100) * SCENE_H
      const s = override.scaleMul ?? 1
      pn.container.scale.set(s, s)
      pn.container.alpha = breaking ? 1 : (override.alphaMul ?? 1)
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
      setMediaPreview(pn, n, lod)
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
      setMediaPreview(pn, n, lod)
      setLabel(pn.label, n, lod)
    }
    this.syncBreakApart(pn, n, breaking)
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
      if (pn.breaking) {
        pn.breaking.aLabel.style.fill = theme?.label ?? NODE_LABEL_FILL
        pn.breaking.bLabel.style.fill = theme?.label ?? NODE_LABEL_FILL
      }
    }
    for (const pn of this.free) {
      pn.label.style.fill = theme?.label ?? NODE_LABEL_FILL
      if (pn.breaking) {
        pn.breaking.aLabel.style.fill = theme?.label ?? NODE_LABEL_FILL
        pn.breaking.bLabel.style.fill = theme?.label ?? NODE_LABEL_FILL
      }
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
    return {
      container,
      shape,
      label,
      wasBreakingApart: false,
      mediaPreviewActive: false,
      breakDirtyKey: '',
      breakMaskKey: '',
      breakLabelKey: '',
      breakStateKey: '',
      dirtyKey: '',
      lod: 'full',
    }
  }

  private syncBreakApart(
    pn: PooledNode,
    n: ModelNode,
    breaking: NodeOverride['breakApart'] | undefined,
  ): void {
    if (!breaking) {
      if (!pn.wasBreakingApart) return
      pn.wasBreakingApart = false
      pn.shape.visible = true
      pn.label.visible = labelKeyOf(n, pn.lod).length > 0
      if (pn.media) {
        pn.media.bg.visible = pn.mediaPreviewActive
        pn.media.sprite.visible = pn.mediaPreviewActive && !!(n.mediaType === 'audio' ? n.audioCoverSrc : n.mediaSrc)
        pn.media.text.visible = pn.mediaPreviewActive && pn.media.text.text.length > 0
      }
      if (pn.breaking) pn.breaking.container.visible = false
      return
    }

    const split = ensureBreakApart(pn, this.theme?.label ?? NODE_LABEL_FILL)
    pn.wasBreakingApart = true
    pn.shape.visible = false
    pn.label.visible = false
    if (pn.media) {
      pn.media.bg.visible = false
      pn.media.sprite.visible = false
      pn.media.text.visible = false
    }
    split.container.visible = true

    const staticKey = dirtyKeyOf(n, 'full', this.theme)
    if (staticKey !== pn.breakDirtyKey) {
      drawBreakShape(split.aShape, n, this.theme)
      drawBreakShape(split.bShape, n, this.theme)
      pn.breakDirtyKey = staticKey
      pn.breakMaskKey = ''
    }
    const text = n.label
    if (text !== pn.breakLabelKey) {
      split.aLabel.text = text
      split.bLabel.text = text
      split.aLabel.visible = text.length > 0
      split.bLabel.visible = text.length > 0
      pn.breakLabelKey = text
    }
    const wPx = (n.w / 100) * SCENE_W
    const hPx = (n.h / 100) * SCENE_H
    const maskKey = breakMaskKeyOf(n, breaking)
    if (maskKey !== pn.breakMaskKey) {
      split.aMask.clear()
      split.bMask.clear()
      if (breaking.axis === 'vertical') {
        split.aMask.rect(-wPx / 2 - 2, -hPx / 2 - 2, wPx / 2 + 2, hPx + 4).fill(0xffffff)
        split.bMask.rect(0, -hPx / 2 - 2, wPx / 2 + 2, hPx + 4).fill(0xffffff)
      } else {
        split.aMask.rect(-wPx / 2 - 2, -hPx / 2 - 2, wPx + 4, hPx / 2 + 2).fill(0xffffff)
        split.bMask.rect(-wPx / 2 - 2, 0, wPx + 4, hPx / 2 + 2).fill(0xffffff)
      }
      pn.breakMaskKey = maskKey
    }
    const stateKey = breakStateKey(breaking)
    if (stateKey === pn.breakStateKey) return
    const ease = breaking.fallRatio
    const fade = Math.max(0, 1 - ease * 1.5)
    split.a.alpha = fade
    split.b.alpha = fade
    if (breaking.axis === 'vertical') {
      split.a.position.set(breaking.shakeX - 80 * ease, breaking.shakeY + 20 * ease)
      split.b.position.set(breaking.shakeX + 80 * ease, breaking.shakeY + 20 * ease)
      split.a.rotation = -15 * Math.PI / 180 * ease
      split.b.rotation = 15 * Math.PI / 180 * ease
    } else {
      split.a.position.set(breaking.shakeX - 20 * ease, breaking.shakeY - 80 * ease)
      split.b.position.set(breaking.shakeX + 20 * ease, breaking.shakeY + 120 * ease)
      split.a.rotation = -15 * Math.PI / 180 * ease
      split.b.rotation = 10 * Math.PI / 180 * ease
    }
    pn.breakStateKey = stateKey
  }
}
