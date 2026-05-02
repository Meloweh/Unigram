/**
 * Tiny Canvas2D drag-preview generator for the components palette.
 *
 * The native HTML drag preview is a snapshot of the source DOM element, which
 * means dragging a palette button shows… a button. We override it with a
 * small canvas painted to look like the node shape that's about to drop.
 *
 * The element is appended off-screen (browsers refuse to render `display:
 * none` drag images) and is auto-removed at the end of the drag.
 */

import type { NodeShape } from '../model/types'

const SIZE = 80
const PAD = 6
const FILL = '#cfe4ff'
const STROKE = '#4aa3ff'

export function createShapeDragPreview(shape: NodeShape): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const ctx = c.getContext('2d')!
  ctx.lineWidth = 2
  ctx.strokeStyle = STROKE
  ctx.fillStyle = FILL
  drawShape(ctx, shape)
  // Off-screen position keeps it out of the layout but still rendered.
  c.style.position = 'fixed'
  c.style.top = '-1000px'
  c.style.left = '-1000px'
  c.style.pointerEvents = 'none'
  document.body.appendChild(c)
  return c
}

function drawShape(ctx: CanvasRenderingContext2D, shape: NodeShape): void {
  const w = SIZE - PAD * 2
  const h = SIZE - PAD * 2
  const cx = SIZE / 2
  const cy = SIZE / 2
  ctx.beginPath()
  switch (shape) {
    case 'rectangle':
      ctx.rect(PAD, PAD, w, h)
      break
    case 'rounded-rect':
      ctx.roundRect(PAD, PAD, w, h, Math.min(w, h) * 0.18)
      break
    case 'circle':
      ctx.arc(cx, cy, Math.min(w, h) / 2, 0, Math.PI * 2)
      break
    case 'oval':
      ctx.ellipse(cx, cy, w / 2, h / 2 * 0.75, 0, 0, Math.PI * 2)
      break
    case 'diamond':
      polyPath(ctx, [[cx, PAD], [SIZE - PAD, cy], [cx, SIZE - PAD], [PAD, cy]])
      break
    case 'hexagon': {
      const cut = w * 0.25
      polyPath(ctx, [
        [PAD + cut, PAD],
        [SIZE - PAD - cut, PAD],
        [SIZE - PAD, cy],
        [SIZE - PAD - cut, SIZE - PAD],
        [PAD + cut, SIZE - PAD],
        [PAD, cy],
      ])
      break
    }
    case 'parallelogram': {
      const skew = w * 0.18
      polyPath(ctx, [
        [PAD + skew, PAD],
        [SIZE - PAD, PAD],
        [SIZE - PAD - skew, SIZE - PAD],
        [PAD, SIZE - PAD],
      ])
      break
    }
    case 'triangle':
      polyPath(ctx, [[cx, PAD], [SIZE - PAD, SIZE - PAD], [PAD, SIZE - PAD]])
      break
    case 'chat-bubble': {
      const r = Math.min(w, h) * 0.22
      ctx.roundRect(PAD, PAD, w, h * 0.78, r)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      polyPath(ctx, [
        [cx - 6, PAD + h * 0.78],
        [cx + 6, PAD + h * 0.78],
        [PAD + 4, SIZE - PAD],
      ])
      break
    }
    case 'thinking-cloud': {
      const ry = h / 2
      const lobes: Array<[number, number, number]> = [
        [cx - w * 0.27, cy + ry * 0.05, ry * 0.42],
        [cx - w * 0.07, cy - ry * 0.20, ry * 0.46],
        [cx + w * 0.15, cy - ry * 0.18, ry * 0.40],
        [cx + w * 0.27, cy + ry * 0.10, ry * 0.36],
        [cx + w * 0.02, cy + ry * 0.30, ry * 0.42],
      ]
      for (const [x, y, r] of lobes) {
        ctx.moveTo(x + r, y)
        ctx.arc(x, y, r, 0, Math.PI * 2)
      }
      break
    }
  }
  ctx.fill()
  ctx.stroke()
}

function polyPath(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): void {
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
}
