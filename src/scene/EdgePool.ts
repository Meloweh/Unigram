/**
 * Pooled `Graphics` per visible edge, plus a pooled mid-line `Text` when the
 * connection carries a label. Edges support legacy parity styling: dash
 * pattern, eight arrow-head styles, optional label, and a `kind: 'flow'` mode
 * that adopts the legacy flow-orange palette.
 *
 * Endpoints are computed by projecting the line direction against each
 * node's shape via `shapeEdgeIntersect`, which keeps the arrow head from
 * sinking into the node body. The legacy renderer relied on the same trick
 * (see `src/old/scene/edgeAnchoring.ts`).
 */

import { Container, Graphics, Text } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import type {
  Connection,
  ConnectionArrowStyle,
  ConnectionDashStyle,
  ModelNode,
} from '../model/types'
import { shapeEdgeIntersect } from './shapeIntersect'
import { NODE_FONT_FAMILY, NODE_LABEL_FILL } from './nodeStyle'

interface PooledEdge {
  gfx: Graphics
  /** Optional label, lazily attached when the connection has a `label`. */
  label: Text | null
  dirtyKey: string
}

export interface EdgeRevealGap {
  wPx: number
  hPx: number
  progress: number
}

const FLOW_COLOR = '#f59e0b'
const DEFAULT_LABEL_FONT = 22

const keyOf = (
  e: Connection,
  from: ModelNode,
  to: ModelNode,
  revealGap: EdgeRevealGap | null,
  emergeProgress: number | null,
): string =>
  `${from.x},${from.y},${from.w},${from.h},${from.shape}|` +
  `${from.cosmeticType ?? ''},${from.tipAngle ?? ''},${from.tipLength ?? ''}|` +
  `${to.x},${to.y},${to.w},${to.h},${to.shape}|` +
  `${to.cosmeticType ?? ''},${to.tipAngle ?? ''},${to.tipLength ?? ''}|` +
  `${e.color}|${e.width}|${e.kind ?? 'default'}|${e.dash ?? 'solid'}|` +
  `${e.arrowStyle ?? 'standard'}|${e.label ?? ''}|${e.labelFontSize ?? 0}|` +
  `${revealGap ? `${revealGap.wPx.toFixed(1)},${revealGap.hPx.toFixed(1)},${revealGap.progress.toFixed(3)}` : '0'}|` +
  `${emergeProgress == null ? 'full' : emergeProgress.toFixed(3)}`

/** Visual size of the arrow head, in scene pixels. */
const ARROW_LEN = 16
const ARROW_HALF_W = 7

/** Dash pattern (on, off, on, off, ...) per dash style, in scene pixels. */
function dashPattern(style: ConnectionDashStyle): number[] | null {
  switch (style) {
    case 'solid': return null
    case 'dashed': return [10, 6]
    case 'dotted': return [2, 6]
    case 'dash-dot': return [10, 6, 2, 6]
  }
}

/** Stroke a line as a series of dash segments. */
function strokeDashed(
  g: Graphics,
  fx: number, fy: number,
  tx: number, ty: number,
  pattern: number[],
  color: string | number,
  width: number,
): void {
  const dx = tx - fx
  const dy = ty - fy
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return
  const ux = dx / len
  const uy = dy / len
  let cursor = 0
  let drawing = true
  let i = 0
  while (cursor < len) {
    const seg = Math.min(pattern[i % pattern.length], len - cursor)
    if (drawing) {
      const sx = fx + ux * cursor
      const sy = fy + uy * cursor
      const ex = fx + ux * (cursor + seg)
      const ey = fy + uy * (cursor + seg)
      g.moveTo(sx, sy).lineTo(ex, ey)
    }
    cursor += seg
    drawing = !drawing
    i++
  }
  g.stroke({ color, width, alignment: 0.5 })
}

/** Draw the chosen arrow head style at (`tx`, `ty`) pointing along (`ux`, `uy`). */
export function drawArrowHead(
  g: Graphics,
  style: ConnectionArrowStyle,
  tx: number, ty: number,
  ux: number, uy: number,
  color: string | number,
  strokeWidth: number,
): void {
  if (style === 'none') return
  const baseX = tx - ux * ARROW_LEN
  const baseY = ty - uy * ARROW_LEN
  const px = -uy
  const py = ux
  switch (style) {
    case 'standard':
    case 'triangle':
    case 'filled-triangle': {
      g.poly([
        tx, ty,
        baseX + px * ARROW_HALF_W, baseY + py * ARROW_HALF_W,
        baseX - px * ARROW_HALF_W, baseY - py * ARROW_HALF_W,
      ])
      g.fill({ color })
      break
    }
    case 'circle': {
      g.circle(tx - ux * (ARROW_LEN * 0.45), ty - uy * (ARROW_LEN * 0.45), ARROW_HALF_W * 0.72)
      g.fill({ color })
      break
    }
    case 'line-arrow': {
      // Two thin strokes forming an open chevron.
      g.moveTo(tx, ty).lineTo(baseX + px * ARROW_HALF_W, baseY + py * ARROW_HALF_W)
      g.moveTo(tx, ty).lineTo(baseX - px * ARROW_HALF_W, baseY - py * ARROW_HALF_W)
      g.stroke({ color, width: Math.max(1.5, strokeWidth), alignment: 0.5 })
      break
    }
    case 'stealth': {
      // Concave-base triangle (notched chevron).
      const notchX = tx - ux * (ARROW_LEN * 0.55)
      const notchY = ty - uy * (ARROW_LEN * 0.55)
      g.poly([
        tx, ty,
        baseX + px * ARROW_HALF_W, baseY + py * ARROW_HALF_W,
        notchX, notchY,
        baseX - px * ARROW_HALF_W, baseY - py * ARROW_HALF_W,
      ])
      g.fill({ color })
      break
    }
    case 'diamond': {
      const midX = tx - ux * (ARROW_LEN / 2)
      const midY = ty - uy * (ARROW_LEN / 2)
      g.poly([
        tx, ty,
        midX + px * ARROW_HALF_W, midY + py * ARROW_HALF_W,
        baseX, baseY,
        midX - px * ARROW_HALF_W, midY - py * ARROW_HALF_W,
      ])
      g.fill({ color })
      break
    }
  }
}

function drawEdge(
  g: Graphics,
  e: Connection,
  from: ModelNode,
  to: ModelNode,
  revealGap: EdgeRevealGap | null,
  emergeProgress: number | null,
): { midX: number; midY: number } | null {
  g.clear()
  const fxC = (from.x / 100) * SCENE_W
  const fyC = (from.y / 100) * SCENE_H
  const txC = (to.x / 100) * SCENE_W
  const tyC = (to.y / 100) * SCENE_H
  const dx = txC - fxC
  const dy = tyC - fyC
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return null

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

  const kind = e.kind ?? 'default'
  const color = kind === 'flow' ? FLOW_COLOR : e.color
  const baseStrokePx = Math.max(1, (e.width / 100) * SCENE_W)
  // Flow connections render slightly thicker to read as primary action lines.
  const strokePx = kind === 'flow' ? Math.max(2, baseStrokePx * 1.4) : baseStrokePx

  const emergeT = emergeProgress == null ? null : Math.max(0, Math.min(1, emergeProgress))
  const partialEmerge = emergeT != null && emergeT < 0.999
  const effectiveTx = partialEmerge ? fx + (tx - fx) * emergeT : tx
  const effectiveTy = partialEmerge ? fy + (ty - fy) * emergeT : ty

  const ndx = effectiveTx - fx
  const ndy = effectiveTy - fy
  const segLen = Math.hypot(ndx, ndy)
  if (segLen < 1e-3) return null
  const ux = ndx / segLen
  const uy = ndy / segLen
  const arrowStyle = partialEmerge ? 'none' : (e.arrowStyle ?? 'standard')
  // Pull the line short of the arrow tip so the stroke doesn't overshoot
  // through the chevron filling. `none` arrows draw the line all the way.
  const inset = arrowStyle === 'none' ? 0 : ARROW_LEN * 0.6
  const lineEndX = effectiveTx - ux * inset
  const lineEndY = effectiveTy - uy * inset

  const dash = dashPattern(e.dash ?? 'solid')
  const drawStroke = (sx: number, sy: number, ex: number, ey: number) => {
    if (dash) {
      strokeDashed(g, sx, sy, ex, ey, dash, color, strokePx)
    } else {
      g.moveTo(sx, sy).lineTo(ex, ey)
      g.stroke({ color, width: strokePx, alignment: 0.5 })
    }
  }
  const buildPopupGap = (): { entry: { x: number; y: number }; exit: { x: number; y: number } } | null => {
    if (!revealGap || revealGap.progress < 0.001) return null
    const lineLen = Math.hypot(lineEndX - fx, lineEndY - fy)
    if (lineLen < 2) return null
    const midX = (fx + lineEndX) / 2
    const midY = (fy + lineEndY) / 2
    const hw = (revealGap.wPx / 2 + 20) * revealGap.progress
    const hh = (revealGap.hPx / 2 + 20) * revealGap.progress
    let t = Infinity
    if (Math.abs(ux) > 1e-9) t = Math.min(t, hw / Math.abs(ux))
    if (Math.abs(uy) > 1e-9) t = Math.min(t, hh / Math.abs(uy))
    t = Math.min(t, lineLen / 2 - 1)
    if (t <= 0 || !Number.isFinite(t)) return null
    return {
      entry: { x: midX - ux * t, y: midY - uy * t },
      exit: { x: midX + ux * t, y: midY + uy * t },
    }
  }
  const gap = buildPopupGap()
  if (gap) {
    drawStroke(fx, fy, gap.entry.x, gap.entry.y)
    drawStroke(gap.exit.x, gap.exit.y, lineEndX, lineEndY)
  } else {
    drawStroke(fx, fy, lineEndX, lineEndY)
  }

  if (!partialEmerge) drawArrowHead(g, arrowStyle, tx, ty, ux, uy, color, strokePx)

  return { midX: (fx + tx) / 2, midY: (fy + ty) / 2 }
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

  acquire(
    e: Connection,
    from: ModelNode,
    to: ModelNode,
    revealGap: EdgeRevealGap | null = null,
    emergeProgress: number | null = null,
  ): void {
    let pe = this.active.get(e.id)
    if (!pe) {
      pe = this.free.pop() ?? { gfx: new Graphics(), label: null, dirtyKey: '' }
      pe.gfx.eventMode = 'none'
      this.layer.addChild(pe.gfx)
      pe.dirtyKey = ''
      this.active.set(e.id, pe)
    }
    this.update(e, from, to, revealGap, emergeProgress)
  }

  update(
    e: Connection,
    from: ModelNode,
    to: ModelNode,
    revealGap: EdgeRevealGap | null = null,
    emergeProgress: number | null = null,
  ): void {
    const pe = this.active.get(e.id)
    if (!pe) return
    const key = keyOf(e, from, to, revealGap, emergeProgress)
    if (key === pe.dirtyKey) return
    const mid = drawEdge(pe.gfx, e, from, to, revealGap, emergeProgress)
    pe.dirtyKey = key
    this.syncLabel(pe, e, emergeProgress != null && emergeProgress < 0.999 ? null : mid)
  }

  private syncLabel(
    pe: PooledEdge,
    e: Connection,
    mid: { midX: number; midY: number } | null,
  ): void {
    const labelText = e.label ?? ''
    if (!labelText || !mid) {
      if (pe.label) pe.label.visible = false
      return
    }
    const fontSize = e.labelFontSize ?? DEFAULT_LABEL_FONT
    if (!pe.label) {
      pe.label = new Text({
        text: labelText,
        style: {
          fontFamily: NODE_FONT_FAMILY,
          fontSize,
          fill: NODE_LABEL_FILL,
          align: 'center',
        },
      })
      pe.label.anchor.set(0.5)
      pe.label.eventMode = 'none'
      this.layer.addChild(pe.label)
    }
    if (pe.label.text !== labelText) pe.label.text = labelText
    if (pe.label.style.fontSize !== fontSize) pe.label.style.fontSize = fontSize
    pe.label.x = mid.midX
    pe.label.y = mid.midY
    pe.label.visible = true
  }

  release(id: string): void {
    const pe = this.active.get(id)
    if (!pe) return
    this.active.delete(id)
    this.layer.removeChild(pe.gfx)
    if (pe.label) {
      this.layer.removeChild(pe.label)
      pe.label.visible = false
    }
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
    for (const pe of this.free) {
      pe.gfx.destroy()
      pe.label?.destroy()
    }
    this.free.length = 0
  }
}
