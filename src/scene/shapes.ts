/**
 * Shape geometry for graph nodes.
 *
 * 8 standard shapes: rectangle, rounded-rect, circle, oval, diamond, hexagon,
 * parallelogram, triangle.
 * 2 cosmetic shapes: chat-bubble, thinking-cloud.
 *
 * Each `drawXxx` writes geometry into a `Graphics` centred on (0, 0). Sizes
 * are pixel-space (already converted from scene-percent by the caller).
 *
 * Cosmetic shapes carry an extra "tip" anchor (chat tail / cloud trail tip)
 * stored on the model node's `extra` slot; callers pass it via `tip`. When
 * absent we fall back to a sensible default.
 */

import type { FillGradient, Graphics } from 'pixi.js'

export type StandardShape =
  | 'rectangle'
  | 'rounded-rect'
  | 'circle'
  | 'oval'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'triangle'

export type CosmeticShape = 'chat-bubble' | 'thinking-cloud'

export type NodeShape = StandardShape | CosmeticShape

export interface DrawOptions {
  /** Width in pixels (full extent). */
  w: number
  /** Height in pixels (full extent). */
  h: number
  /** Solid colour (`#rrggbb` / int) or a Pixi `FillGradient` instance. */
  fill: string | number | FillGradient
  stroke: string | number
  strokeWidth: number
  /** Cosmetic-only: tip offset from node centre, in pixels. */
  tip?: { x: number; y: number }
}

/**
 * Path-only variant: lays down the geometry into `g` without applying fill
 * or stroke. The caller follows up with `g.fill(...)` / `g.stroke(...)`.
 *
 * Used by the selection/flow aura layers, which need the silhouette filled
 * with their own colour + alpha + blur — not the node body's styling.
 *
 * `tip` is the cosmetic chat-tail / cloud-trail anchor (pixels from centre).
 */
export function drawNodeShapePath(
  g: Graphics,
  shape: NodeShape,
  w: number,
  h: number,
  tip?: { x: number; y: number },
): void {
  switch (shape) {
    case 'rectangle':
      g.rect(-w / 2, -h / 2, w, h)
      break
    case 'rounded-rect':
      g.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.18)
      break
    case 'circle':
      g.circle(0, 0, Math.min(w, h) / 2)
      break
    case 'oval':
      g.ellipse(0, 0, w / 2, h / 2)
      break
    case 'diamond':
      g.poly([0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0])
      break
    case 'hexagon': {
      const hw = w / 2
      const hh = h / 2
      const cut = hw * 0.5
      g.poly([
        -hw + cut, -hh,
        hw - cut, -hh,
        hw, 0,
        hw - cut, hh,
        -hw + cut, hh,
        -hw, 0,
      ])
      break
    }
    case 'parallelogram': {
      const skew = w * 0.18
      g.poly([
        -w / 2 + skew, -h / 2,
        w / 2, -h / 2,
        w / 2 - skew, h / 2,
        -w / 2, h / 2,
      ])
      break
    }
    case 'triangle':
      g.poly([0, -h / 2, w / 2, h / 2, -w / 2, h / 2])
      break
    case 'chat-bubble': {
      const r = Math.min(w, h) * 0.22
      g.roundRect(-w / 2, -h / 2, w, h, r)
      const t = tip ?? { x: -w * 0.45, y: h * 0.85 }
      const baseX = Math.max(-w / 2 + r, Math.min(w / 2 - r, t.x * 0.35))
      const baseY = h / 2
      const halfBase = Math.max(h * 0.06, 4)
      g.poly([baseX - halfBase, baseY, baseX + halfBase, baseY, t.x, t.y])
      break
    }
    case 'thinking-cloud': {
      const rx = w / 2
      const ry = h / 2
      const lobes: Array<[number, number, number]> = [
        [-rx * 0.55, ry * 0.05, ry * 0.85],
        [-rx * 0.15, -ry * 0.35, ry * 0.95],
        [rx * 0.30, -ry * 0.30, ry * 0.85],
        [rx * 0.55, ry * 0.10, ry * 0.75],
        [rx * 0.05, ry * 0.40, ry * 0.85],
      ]
      for (const [x, y, r] of lobes) g.circle(x, y, r)
      const t = tip ?? { x: -w * 0.55, y: h * 0.95 }
      g.circle(t.x * 0.55, t.y * 0.55, ry * 0.32)
      g.circle(t.x * 0.85, t.y * 0.85, ry * 0.18)
      break
    }
  }
}

/** Dispatch — writes a fully styled shape into `g`. Caller does `g.clear()`. */
export function drawNodeShape(g: Graphics, shape: NodeShape, o: DrawOptions): void {
  switch (shape) {
    case 'rectangle':
      drawRectangle(g, o)
      break
    case 'rounded-rect':
      drawRoundedRect(g, o)
      break
    case 'circle':
      drawCircle(g, o)
      break
    case 'oval':
      drawOval(g, o)
      break
    case 'diamond':
      drawDiamond(g, o)
      break
    case 'hexagon':
      drawHexagon(g, o)
      break
    case 'parallelogram':
      drawParallelogram(g, o)
      break
    case 'triangle':
      drawTriangle(g, o)
      break
    case 'chat-bubble':
      drawChatBubble(g, o)
      break
    case 'thinking-cloud':
      drawThinkingCloud(g, o)
      break
  }
}

function applyFillStroke(g: Graphics, o: DrawOptions): void {
  // Pixi's `fill()` accepts a `FillGradient` directly, or a colour-bearing
  // options object for solid colours.
  if (typeof o.fill === 'object') g.fill(o.fill)
  else g.fill({ color: o.fill })
  g.stroke({ color: o.stroke, width: o.strokeWidth, alignment: 0.5 })
}

function drawRectangle(g: Graphics, o: DrawOptions): void {
  g.rect(-o.w / 2, -o.h / 2, o.w, o.h)
  applyFillStroke(g, o)
}

function drawRoundedRect(g: Graphics, o: DrawOptions): void {
  const r = Math.min(o.w, o.h) * 0.18
  g.roundRect(-o.w / 2, -o.h / 2, o.w, o.h, r)
  applyFillStroke(g, o)
}

function drawCircle(g: Graphics, o: DrawOptions): void {
  const r = Math.min(o.w, o.h) / 2
  g.circle(0, 0, r)
  applyFillStroke(g, o)
}

function drawOval(g: Graphics, o: DrawOptions): void {
  g.ellipse(0, 0, o.w / 2, o.h / 2)
  applyFillStroke(g, o)
}

function drawDiamond(g: Graphics, o: DrawOptions): void {
  g.poly([0, -o.h / 2, o.w / 2, 0, 0, o.h / 2, -o.w / 2, 0])
  applyFillStroke(g, o)
}

function drawHexagon(g: Graphics, o: DrawOptions): void {
  // Pointy-top hexagon inscribed in the w×h box.
  const w = o.w / 2
  const h = o.h / 2
  // Side cut at 25% width, matching legacy.
  const cut = w * 0.5
  g.poly([
    -w + cut, -h,
    w - cut, -h,
    w, 0,
    w - cut, h,
    -w + cut, h,
    -w, 0,
  ])
  applyFillStroke(g, o)
}

function drawParallelogram(g: Graphics, o: DrawOptions): void {
  const skew = o.w * 0.18
  g.poly([
    -o.w / 2 + skew, -o.h / 2,
    o.w / 2, -o.h / 2,
    o.w / 2 - skew, o.h / 2,
    -o.w / 2, o.h / 2,
  ])
  applyFillStroke(g, o)
}

function drawTriangle(g: Graphics, o: DrawOptions): void {
  // Equilateral-ish, base on the bottom.
  g.poly([0, -o.h / 2, o.w / 2, o.h / 2, -o.w / 2, o.h / 2])
  applyFillStroke(g, o)
}

// ---- cosmetic ------------------------------------------------------------

function drawChatBubble(g: Graphics, o: DrawOptions): void {
  // Rounded-rect body with a small triangular tail pointing at `tip`.
  const r = Math.min(o.w, o.h) * 0.22
  g.roundRect(-o.w / 2, -o.h / 2, o.w, o.h, r)
  applyFillStroke(g, o)
  const tip = o.tip ?? { x: -o.w * 0.45, y: o.h * 0.85 }
  // Tail anchored on the bottom-left edge; widens by ~12% of node height.
  const baseX = Math.max(-o.w / 2 + r, Math.min(o.w / 2 - r, tip.x * 0.35))
  const baseY = o.h / 2
  const halfBase = Math.max(o.h * 0.06, 4)
  g.poly([baseX - halfBase, baseY, baseX + halfBase, baseY, tip.x, tip.y])
  applyFillStroke(g, o)
}

function drawThinkingCloud(g: Graphics, o: DrawOptions): void {
  // Compose a cloud from 5 overlapping circles, plus 2 trail bubbles toward `tip`.
  const cx = 0
  const cy = 0
  const rx = o.w / 2
  const ry = o.h / 2
  const lobes: Array<[number, number, number]> = [
    [cx - rx * 0.55, cy + ry * 0.05, ry * 0.85],
    [cx - rx * 0.15, cy - ry * 0.35, ry * 0.95],
    [cx + rx * 0.30, cy - ry * 0.30, ry * 0.85],
    [cx + rx * 0.55, cy + ry * 0.10, ry * 0.75],
    [cx + rx * 0.05, cy + ry * 0.40, ry * 0.85],
  ]
  for (const [x, y, r] of lobes) g.circle(x, y, r)
  applyFillStroke(g, o)

  const tip = o.tip ?? { x: -o.w * 0.55, y: o.h * 0.95 }
  // Two diminishing trail bubbles between the cloud edge and the tip.
  const trail: Array<[number, number, number]> = [
    [tip.x * 0.55, tip.y * 0.55, ry * 0.32],
    [tip.x * 0.85, tip.y * 0.85, ry * 0.18],
  ]
  for (const [x, y, r] of trail) g.circle(x, y, r)
  applyFillStroke(g, o)
}

// ---- narrow-phase hit-test ----------------------------------------------

/**
 * Point-in-shape test in node-local coordinates (centred on the node).
 * Used as a narrow-phase filter on quadtree pick candidates so e.g. clicks
 * just outside a triangle's hypotenuse do not register.
 */
export function pointInShape(
  shape: NodeShape,
  px: number,
  py: number,
  w: number,
  h: number,
): boolean {
  const ax = Math.abs(px)
  const ay = Math.abs(py)
  switch (shape) {
    case 'rectangle':
    case 'rounded-rect':
      // Treat rounded-rect as rect for hit purposes — slop on the corners is
      // imperceptible and keeps the path branchless.
      return ax <= w / 2 && ay <= h / 2
    case 'circle': {
      const r = Math.min(w, h) / 2
      return px * px + py * py <= r * r
    }
    case 'oval': {
      const a = w / 2
      const b = h / 2
      return (px * px) / (a * a) + (py * py) / (b * b) <= 1
    }
    case 'diamond':
      return ax / (w / 2) + ay / (h / 2) <= 1
    case 'hexagon': {
      // Inscribed hexagon: same poly we draw above.
      const halfW = w / 2
      const halfH = h / 2
      const cut = halfW * 0.5
      return pointInPolygon(px, py, [
        -halfW + cut, -halfH,
        halfW - cut, -halfH,
        halfW, 0,
        halfW - cut, halfH,
        -halfW + cut, halfH,
        -halfW, 0,
      ])
    }
    case 'parallelogram': {
      const halfW = w / 2
      const halfH = h / 2
      const skew = w * 0.18
      return pointInPolygon(px, py, [
        -halfW + skew, -halfH,
        halfW, -halfH,
        halfW - skew, halfH,
        -halfW, halfH,
      ])
    }
    case 'triangle':
      return pointInPolygon(px, py, [0, -h / 2, w / 2, h / 2, -w / 2, h / 2])
    case 'chat-bubble':
    case 'thinking-cloud':
      // Cosmetic shapes use the bounding rect for hit purposes — the visual
      // overhang into the tip area should still register as a click.
      return ax <= w / 2 && ay <= h / 2
  }
}

function pointInPolygon(px: number, py: number, pts: number[]): boolean {
  let inside = false
  const n = pts.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]
    const yi = pts[i * 2 + 1]
    const xj = pts[j * 2]
    const yj = pts[j * 2 + 1]
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
