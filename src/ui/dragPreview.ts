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
import { chatBubblePathPoints, DEFAULT_COSMETIC_TIP_ANGLE, DEFAULT_COSMETIC_TIP_LENGTH, thinkingCloudTrail } from '../scene/cosmeticGeometry'

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
      const bodyH = h * 0.72
      const p = chatBubblePathPoints(w, bodyH, DEFAULT_COSMETIC_TIP_ANGLE, DEFAULT_COSMETIC_TIP_LENGTH * 0.8)
      const left = PAD
      const right = PAD + w
      const top = PAD + 4
      const bottom = top + bodyH
      const baseX = cx + p.baseX
      const lb = Math.max(left + p.r, baseX - p.tipW)
      const rb = Math.min(right - p.r, baseX + p.tipW)
      ctx.moveTo(left + p.r, top)
      ctx.lineTo(right - p.r, top)
      ctx.quadraticCurveTo(right, top, right, top + p.r)
      ctx.lineTo(right, bottom - p.r)
      ctx.quadraticCurveTo(right, bottom, right - p.r, bottom)
      ctx.lineTo(rb, bottom)
      ctx.lineTo(cx + p.apexX, top + bodyH / 2 + p.apexY)
      ctx.lineTo(lb, bottom)
      ctx.lineTo(left + p.r, bottom)
      ctx.quadraticCurveTo(left, bottom, left, bottom - p.r)
      ctx.lineTo(left, top + p.r)
      ctx.quadraticCurveTo(left, top, left + p.r, top)
      ctx.closePath()
      break
    }
    case 'thinking-cloud': {
      const cloudW = w * 0.9
      const cloudH = h * 0.64
      const rx = cloudW / 2
      const ry = cloudH / 2
      const pts: Array<[number, number]> = [
        [cx - rx * 0.18, cy - ry * 0.55],
        [cx + rx * 0.15, cy - ry * 0.58],
        [cx + rx * 0.45, cy - ry * 0.34],
        [cx + rx * 0.61, cy - ry * 0.04],
        [cx + rx * 0.48, cy + ry * 0.30],
        [cx + rx * 0.18, cy + ry * 0.52],
        [cx - rx * 0.18, cy + ry * 0.50],
        [cx - rx * 0.50, cy + ry * 0.32],
        [cx - rx * 0.62, cy + ry * 0.02],
        [cx - rx * 0.48, cy - ry * 0.30],
      ]
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i]
        const next = pts[(i + 1) % pts.length]
        ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2)
      }
      ctx.closePath()
      for (const c of thinkingCloudTrail(cloudW, cloudH, DEFAULT_COSMETIC_TIP_ANGLE, DEFAULT_COSMETIC_TIP_LENGTH * 0.8)) {
        ctx.moveTo(cx + c.cx + c.r, cy + c.cy)
        ctx.arc(cx + c.cx, cy + c.cy, c.r, 0, Math.PI * 2)
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
