/**
 * Pooled Pixi `Container`s for nodes. One container per visible node, reused
 * across frames. Acquire/release are O(1) and produce zero garbage on the
 * steady-state hot path.
 *
 * The pool only knows about scene-graph entities. Coordinate translation,
 * culling, and store mediation happen one layer up in `SceneRenderer`.
 */

import { CanvasTextMetrics, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import { DEFAULT_NODE, type ModelNode, type TextFormatRange } from '../model/types'
import type { NodeOverride } from '../flow/types'
import { textGenFitLabelOf, textGenVisibleLabelOf } from '../audio/TextGenRunner'
import { drawNodeShape, drawNodeShapePath } from './shapes'
import { cosmeticTip, cosmeticTypeOf } from './cosmeticGeometry'
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
  formattedLabel?: PooledFormattedLabel
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
  mask: Graphics
  text: Text
}

interface PooledFormattedLabel {
  container: Container
  texts: Text[]
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
  pad: number
  alpha: number
  fontSize: number
  bgVisible: boolean
}

/** Fixed label breathing room. Kept in pixels so long labels do not grow excess whitespace. */
const TEXT_PAD_X_PX = 30
const TEXT_PAD_Y_PX = 18

function pctW(px: number): number {
  return (px / SCENE_W) * 100
}

function pctH(px: number): number {
  return (px / SCENE_H) * 100
}

function labelFit(n: ModelNode): { inset: number; padW: number; padH: number } {
  const type = cosmeticTypeOf(n)
  if (type === 'thinking-cloud') {
    return { inset: 0.58, padW: (100 / SCENE_W) * 100, padH: (80 / SCENE_H) * 100 }
  }
  if (type === 'chat-bubble') return { inset: 0.74, padW: 1.6, padH: 1.4 }
  if (n.shape === 'circle') return { inset: 0.7, padW: pctW(TEXT_PAD_X_PX), padH: pctH(TEXT_PAD_Y_PX) }
  if (n.shape === 'oval') return { inset: 0.78, padW: pctW(TEXT_PAD_X_PX), padH: pctH(TEXT_PAD_Y_PX) }
  if (n.shape === 'diamond' || n.shape === 'triangle') {
    return { inset: 0.6, padW: pctW(TEXT_PAD_X_PX), padH: pctH(TEXT_PAD_Y_PX) }
  }
  if (n.shape === 'hexagon') return { inset: 0.86, padW: pctW(TEXT_PAD_X_PX), padH: pctH(TEXT_PAD_Y_PX) }
  return { inset: 1, padW: pctW(TEXT_PAD_X_PX), padH: pctH(TEXT_PAD_Y_PX) }
}

const dirtyKeyOf = (n: ModelNode, lod: Lod, showLabel: boolean, theme: ThemeColors | null): string =>
  `${lod}|${showLabel ? 1 : 0}|${n.shape}|${n.cosmeticType ?? ''}|${n.w}|${n.h}|${effectiveCellColor(n, theme)}|${effectiveMembraneColor(n, theme)}|${n.membraneVisible === false ? 0 : 1}|${n.previewOf ? 1 : 0}|${n.tip?.x ?? 0}|${n.tip?.y ?? 0}|${n.tipAngle ?? ''}|${n.tipLength ?? ''}|${n.label}|${JSON.stringify(n.textFormats ?? [])}|${n.mediaType ?? ''}|${n.mediaSrc ?? ''}|${n.audioCoverSrc ?? ''}|${n.mediaFileName ?? ''}|${n.contentSource ?? ''}|${n.contentCollapsed ?? ''}|${n.contentFontSize ?? ''}`

interface DisplayLabel {
  text: string
  sourceOffset: number
}

const labelKeyOf = (n: ModelNode, showLabel: boolean): string => labelDisplayOf(n, showLabel).text

function labelDisplayOf(n: ModelNode, showLabel: boolean): DisplayLabel {
  if (!showLabel || n.mediaType) return { text: '', sourceOffset: 0 }
  const generated = textGenVisibleLabelOf(n)
  if (generated) return { text: generated.text, sourceOffset: generated.start }
  return { text: n.label, sourceOffset: 0 }
}

function measuredLabelSize(t: Text, fitText?: string): { width: number; height: number } {
  const text = fitText ?? t.text
  if (!text) return { width: 0, height: 0 }
  const measureText = text
    .split('\n')
    .map((line) => (line.length > 0 ? line : ' '))
    .join('\n')
  const metrics = CanvasTextMetrics.measureText(measureText, t.style)
  return { width: metrics.width, height: metrics.height }
}

function fitNodeToLabel(n: ModelNode, t: Text, measured?: { width: number; height: number } | null): { w: number; h: number } {
  const { width, height } = measured ?? measuredLabelSize(t, textGenFitLabelOf(n))
  const fit = labelFit(n)
  return {
    w: Math.max(NODE_MIN_W, (width / fit.inset / SCENE_W) * 100 + fit.padW),
    h: Math.max(NODE_MIN_H, (height / fit.inset / SCENE_H) * 100 + fit.padH),
  }
}

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
    ? { x: (n.tip.x / 100) * wPx, y: (n.tip.y / 100) * hPx }
    : undefined
  const resolvedTip = cosmeticTip(n)
  // `simple` LOD draws a flat fill (cheap); `full` uses the cached gradient
  // for the legacy 145° cell→darker look.
  const fill = lod === 'simple' ? cell : nodeFillGradient(cell)
  drawNodeShape(g, n.shape, {
    w: wPx,
    h: hPx,
    fill,
    stroke: membrane,
    strokeWidth: n.membraneVisible === false ? 0 : NODE_STROKE_WIDTH,
    tip,
    tipAngle: resolvedTip.angle,
    tipLength: resolvedTip.length,
  })
}

function drawBreakShape(g: Graphics, n: ModelNode, theme: ThemeColors | null): void {
  drawShape(g, n, 'full', theme)
}

function setLabel(t: Text, n: ModelNode, showLabel: boolean, fill: number): void {
  const text = labelKeyOf(n, showLabel)
  if (t.text !== text) t.text = text
  applyLabelFormats(t, n, fill)
  t.rotation = 0
  t.scale.set(1, 1)
  t.skew.set(0, 0)
  t.visible = text.length > 0
}

function applyLabelFormats(t: Text, n: ModelNode, fallbackFill: number): void {
  const formats = n.textFormats ?? []
  const textLen = String(t.text ?? '').length
  const sourceOffset = textGenVisibleLabelOf(n)?.start ?? 0
  const sourceEnd = sourceOffset + textLen
  const style = t.style as typeof t.style & {
    fontWeight?: string
    fontStyle?: string
    textDecoration?: string
  }
  style.fontSize = NODE_FONT_SIZE
  style.fill = fallbackFill
  style.fontWeight = 'normal'
  style.fontStyle = 'normal'
  style.textDecoration = 'none'
  for (const f of formats) {
    if (f.start > sourceOffset || f.end < sourceEnd) continue
    if (f.end <= f.start) continue
    if (f.bold) style.fontWeight = '700'
    if (f.italic) style.fontStyle = 'italic'
    if (f.strikethrough) style.textDecoration = 'line-through'
    if (f.color) style.fill = f.color
    if (f.fontSize && f.fontSize > 0) style.fontSize = f.fontSize
  }
}

function ensureFormattedLabel(pn: PooledNode): PooledFormattedLabel {
  if (pn.formattedLabel) return pn.formattedLabel
  const container = new Container()
  container.eventMode = 'none'
  pn.container.addChild(container)
  pn.formattedLabel = { container, texts: [] }
  return pn.formattedLabel
}

function setFormattedLabel(
  pn: PooledNode,
  n: ModelNode,
  showLabel: boolean,
  fallbackFill: number,
): { width: number; height: number } | null {
  const formats = n.textFormats ?? []
  const display = labelDisplayOf(n, showLabel)
  const text = display.text
  const sourceOffset = display.sourceOffset
  const displayEnd = sourceOffset + text.length
  const visibleFormats = formats.filter((f) => f.end > sourceOffset && f.start < displayEnd && f.end > f.start)
  const needsLayer = visibleFormats.some((f) =>
    f.start > sourceOffset ||
    f.end < displayEnd ||
    hasAnimatedTextTransform(f),
  )
  if (!text || !needsLayer) {
    if (pn.formattedLabel) pn.formattedLabel.container.visible = false
    return null
  }
  pn.label.visible = false
  const layer = ensureFormattedLabel(pn)
  layer.container.visible = true
  const lines = text.split('\n')
  let used = 0
  let globalStart = 0
  const layouts: Array<{
    width: number
    height: number
    segments: Array<{ text: Text; width: number; format?: TextFormatRange }>
  }> = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const lineEnd = globalStart + line.length
    const cuts = new Set<number>([globalStart, lineEnd])
    const lineSourceStart = sourceOffset + globalStart
    const lineSourceEnd = sourceOffset + lineEnd
    for (const f of visibleFormats) {
      const start = Math.max(lineSourceStart, f.start)
      const end = Math.min(lineSourceEnd, f.end)
      if (end <= start) continue
      cuts.add(start - sourceOffset)
      cuts.add(end - sourceOffset)
    }
    const sortedCuts = [...cuts].sort((a, b) => a - b)
    for (let ci = 0; ci < sortedCuts.length - 1; ci++) {
      const start = sortedCuts[ci]
      const end = sortedCuts[ci + 1]
      if (end <= start) continue
      const segment = line.slice(start - globalStart, end - globalStart)
      let t = layer.texts[used]
      if (!t) {
        t = new Text({
          text: '',
          style: {
            fontFamily: NODE_FONT_FAMILY,
            fontSize: NODE_FONT_SIZE,
            fill: fallbackFill,
            align: 'left',
          },
        })
        t.anchor.set(0, 0.5)
        layer.container.addChild(t)
        layer.texts.push(t)
      }
      t.visible = true
      t.text = segment
      const style = t.style as typeof t.style & {
        fontWeight?: string
        fontStyle?: string
        textDecoration?: string
      }
      const sourceStart = sourceOffset + start
      const sourceEnd = sourceOffset + end
      const f = visibleFormats.find((candidate) => candidate.end > sourceStart && candidate.start < sourceEnd)
      style.fontFamily = f?.fontFamily ?? NODE_FONT_FAMILY
      style.fontSize = f?.fontSize && f.fontSize > 0 ? f.fontSize : NODE_FONT_SIZE
      style.fill = f?.color ?? fallbackFill
      style.fontWeight = f?.bold ? '700' : 'normal'
      style.fontStyle = f?.italic ? 'italic' : 'normal'
      style.textDecoration = f?.strikethrough ? 'line-through' : 'none'
      t.rotation = ((f?.rotationDeg ?? 0) * Math.PI) / 180
      t.scale.set(f?.scaleX ?? 1, f?.scaleY ?? 1)
      t.skew.set(((f?.skewXDeg ?? 0) * Math.PI) / 180, 0)
      const metrics = CanvasTextMetrics.measureText(segment || ' ', t.style)
      let layout = layouts[li]
      if (!layout) {
        layout = { width: 0, height: 0, segments: [] }
        layouts[li] = layout
      }
      const scaleX = f?.scaleX ?? 1
      const scaleY = f?.scaleY ?? 1
      const visualWidth = metrics.width * Math.max(0.01, Math.abs(scaleX)) + Math.abs(f?.offsetX ?? 0) * 2
      layout.segments.push({ text: t, width: visualWidth, format: f })
      layout.width += visualWidth
      const offsetY = f?.offsetY ?? 0
      layout.height = Math.max(layout.height, ((metrics.height || NODE_FONT_SIZE * 1.2) * Math.max(0.01, Math.abs(scaleY))) + Math.abs(offsetY) * 2)
      used++
    }
    if (!layouts[li]) {
      const metrics = CanvasTextMetrics.measureText('Mg', pn.label.style)
      layouts[li] = { width: 0, height: metrics.height || NODE_FONT_SIZE * 1.2, segments: [] }
    }
    globalStart = lineEnd + 1
  }
  let totalH = 0
  let maxW = 0
  for (const layout of layouts) totalH += layout?.height || NODE_FONT_SIZE * 1.2
  let yCursor = -totalH / 2
  for (const layout of layouts) {
    if (!layout) continue
    maxW = Math.max(maxW, layout.width)
    let x = -layout.width / 2
    const y = yCursor + layout.height / 2
    for (const segment of layout.segments) {
      segment.text.x = x + (segment.format?.offsetX ?? 0)
      segment.text.y = y + (segment.format?.offsetY ?? 0)
      x += segment.width
    }
    yCursor += layout.height
  }
  for (let i = used; i < layer.texts.length; i++) layer.texts[i].visible = false
  return { width: maxW, height: totalH }
}

function hasAnimatedTextTransform(f: TextFormatRange): boolean {
  return !!(
    f.offsetX ||
    f.offsetY ||
    f.rotationDeg ||
    f.scaleX ||
    f.scaleY ||
    f.skewXDeg
  )
}

function mediaPreviewState(n: ModelNode, lod: Lod): MediaPreviewState {
  const active = lod === 'full' && !!n.mediaType
  if (!active) {
    return { active: false, spriteSrc: '', text: '', innerW: 0, innerH: 0, pad: 0, alpha: 0, fontSize: 0, bgVisible: false }
  }

  const wPx = (n.w / 100) * SCENE_W
  const hPx = (n.h / 100) * SCENE_H
  const fillsNode = n.mediaType === 'image' || n.mediaType === 'gif' || n.mediaType === 'video'
  const pad = fillsNode && n.membraneVisible !== false
    ? NODE_STROKE_WIDTH * 0.5
    : fillsNode
      ? 0
      : Math.min(14, Math.max(4, Math.min(wPx, hPx) * 0.08))
  const innerW = Math.max(1, wPx - pad * 2)
  const innerH = Math.max(1, hPx - pad * 2)
  const spriteSrc = n.mediaType === 'audio' ? n.audioCoverSrc : n.mediaSrc
  const canSprite = !!spriteSrc && (n.mediaType === 'image' || n.mediaType === 'gif' || n.mediaType === 'video' || n.mediaType === 'audio')
  const text = mediaPreviewText(n)
  return {
    active: true,
    spriteSrc: canSprite ? spriteSrc : '',
    text,
    innerW,
    innerH,
    pad,
    alpha: n.mediaType === 'audio' ? 0.7 : 0.9,
    fontSize: Math.max(10, Math.min(18, innerH * 0.22)),
    bgVisible: !fillsNode || !canSprite || text.length > 0,
  }
}

function setMediaPreview(pn: PooledNode, n: ModelNode, lod: Lod): void {
  const state = mediaPreviewState(n, lod)
  if (!state.active && !pn.mediaPreviewActive && !pn.media) return
  const media = pn.media ?? ensureMedia(pn)
  media.bg.visible = state.active && state.bgVisible
  media.sprite.visible = false
  media.mask.visible = false
  media.text.visible = false
  pn.mediaPreviewActive = state.active
  if (!state.active) return

  media.bg.clear()
  if (state.bgVisible) {
    drawMediaPreviewShape(media.bg, n, state.innerW, state.innerH, state.pad)
    media.bg.fill({ color: 0xffffff, alpha: 0.32 })
  }

  if (state.spriteSrc) {
    media.sprite.texture = Texture.from(state.spriteSrc)
    media.sprite.visible = true
    media.sprite.width = state.innerW
    media.sprite.height = state.innerH
    media.sprite.x = -state.innerW / 2
    media.sprite.y = -state.innerH / 2
    media.sprite.alpha = state.alpha
    media.mask.clear()
    drawMediaPreviewShape(media.mask, n, state.innerW, state.innerH, state.pad)
    media.mask.fill({ color: 0xffffff, alpha: 1 })
    media.mask.visible = true
  }

  media.text.text = state.text
  media.text.visible = media.text.text.length > 0
  media.text.style.fontSize = state.fontSize
  media.text.style.wordWrapWidth = Math.max(20, state.innerW - 12)
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
  return ''
}

function drawMediaPreviewShape(g: Graphics, n: ModelNode, wPx: number, hPx: number, insetPx: number): void {
  if (n.shape === 'rounded-rect') {
    const outerRadius = Math.min(wPx + insetPx * 2, hPx + insetPx * 2) * 0.18
    g.roundRect(-wPx / 2, -hPx / 2, wPx, hPx, Math.max(0, outerRadius - insetPx))
    return
  }
  const tip = n.tip
    ? { x: (n.tip.x / 100) * wPx, y: (n.tip.y / 100) * hPx }
    : undefined
  const resolvedTip = cosmeticTip(n)
  drawNodeShapePath(g, n.shape, wPx, hPx, tip, resolvedTip.angle, resolvedTip.length)
}

function ensureMedia(pn: PooledNode): PooledMedia {
  if (pn.media) return pn.media
  const bg = new Graphics()
  bg.eventMode = 'none'
  bg.visible = false
  const sprite = new Sprite()
  sprite.eventMode = 'none'
  sprite.visible = false
  const mask = new Graphics()
  mask.eventMode = 'none'
  mask.visible = false
  sprite.mask = mask
  const text = new Text({
    text: '',
    style: {
      fontFamily: NODE_FONT_FAMILY,
      fontSize: 14,
      fill: NODE_LABEL_FILL,
      align: 'center',
      wordWrap: true,
      breakWords: true,
      wordWrapWidth: 180,
    },
  })
  text.anchor.set(0.5)
  text.visible = false
  const labelIndex = pn.container.getChildIndex(pn.label)
  pn.container.addChildAt(bg, labelIndex)
  pn.container.addChildAt(sprite, labelIndex + 1)
  pn.container.addChildAt(mask, labelIndex + 2)
  pn.container.addChildAt(text, labelIndex + 3)
  pn.media = { bg, sprite, mask, text }
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
  acquire(n: ModelNode, lod: Lod, override?: NodeOverride, showLabel = lod === 'full'): void {
    let pn = this.active.get(n.id)
    if (!pn) {
      pn = this.free.pop() ?? this.createNew()
      this.layer.addChild(pn.container)
      pn.dirtyKey = '' // force redraw
      this.active.set(n.id, pn)
    }
    this.update(n, lod, override, showLabel)
  }

  /** Update an already-visible node. No-op if nothing visual changed. */
  update(n: ModelNode, lod: Lod, override?: NodeOverride, showLabel = lod === 'full'): void {
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
      pn.container.rotation = ((override.rotationDeg ?? 0) * Math.PI) / 180
      pn.container.alpha = breaking ? 1 : (override.alphaMul ?? 1) * (n.previewOf ? 0.62 : 1)
      pn.container.tint = override.tint ?? 0xffffff
    } else {
      pn.container.x = baseX
      pn.container.y = baseY
      if (pn.container.scale.x !== 1) pn.container.scale.set(1, 1)
      if (pn.container.rotation !== 0) pn.container.rotation = 0
      const alpha = n.previewOf ? 0.62 : 1
      if (pn.container.alpha !== alpha) pn.container.alpha = alpha
      if (pn.container.tint !== 0xffffff) pn.container.tint = 0xffffff
    }
    const key = dirtyKeyOf(n, lod, showLabel, this.theme)
    const labelFill = this.theme?.label ?? NODE_LABEL_FILL
    if (key !== pn.dirtyKey) {
      setLabel(pn.label, n, showLabel, labelFill)
      const formattedSize = setFormattedLabel(pn, n, lod === 'full' && showLabel, labelFill)
      if (lod === 'full' && this.onNodeFit && showLabel && !n.mediaType) {
        const required = fitNodeToLabel(n, pn.label, formattedSize)
        if (Math.abs(required.w - n.w) > 0.01 || Math.abs(required.h - n.h) > 0.01) {
          this.onNodeFit(n.id, required.w, required.h)
        }
      }
      drawShape(pn.shape, n, lod, this.theme)
      setMediaPreview(pn, n, lod)
      pn.dirtyKey = dirtyKeyOf(n, lod, showLabel, this.theme)
      pn.lod = lod
    } else {
      // Label text can change while shape stays stable.
      setMediaPreview(pn, n, lod)
      setLabel(pn.label, n, showLabel, labelFill)
      setFormattedLabel(pn, n, lod === 'full' && showLabel, labelFill)
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
      pn.label.visible = pn.label.text.length > 0
      if (pn.formattedLabel) pn.formattedLabel.container.visible = (n.textFormats?.length ?? 0) > 0
      if (pn.media) {
        const mediaState = mediaPreviewState(n, pn.lod)
        pn.media.bg.visible = pn.mediaPreviewActive && mediaState.bgVisible
        pn.media.sprite.visible = pn.mediaPreviewActive && mediaState.spriteSrc.length > 0
        pn.media.mask.visible = pn.media.sprite.visible
        pn.media.text.visible = pn.mediaPreviewActive && pn.media.text.text.length > 0
      }
      if (pn.breaking) pn.breaking.container.visible = false
      return
    }

    const split = ensureBreakApart(pn, this.theme?.label ?? NODE_LABEL_FILL)
    pn.wasBreakingApart = true
    pn.shape.visible = false
    pn.label.visible = false
    if (pn.formattedLabel) pn.formattedLabel.container.visible = false
    if (pn.media) {
      pn.media.bg.visible = false
      pn.media.sprite.visible = false
      pn.media.mask.visible = false
      pn.media.text.visible = false
    }
    split.container.visible = true

    const staticKey = dirtyKeyOf(n, 'full', true, this.theme)
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
