/**
 * PixiUnzipConnection — draws unzipping (bow / popup-routing) connections
 * as PixiJS Graphics paths, porting buildTrackForPopup + buildFallbackTrack
 * from the original SVG ConnectionLine.
 */
import { Graphics } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import type { ConnectionRenderData } from './PixiConnectionRenderer'
import { getPixiTheme } from './pixiThemeBridge'

// ─── resolve stroke properties ────────────────────────────────────────

function resolveStroke(c: ConnectionRenderData): { color: number; alpha: number; width: number } {
  const isFlow = c.connectionType === 'flow'
  const width = c.strokeWidth ?? (isFlow ? 3 : 2)

  if (c.strokeColor) {
    const raw = c.strokeColor.trim()
    const rgbaMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1])
      const g = parseInt(rgbaMatch[2])
      const b = parseInt(rgbaMatch[3])
      const a = rgbaMatch[4] != null ? parseFloat(rgbaMatch[4]) : 1
      return { color: (r << 16) | (g << 8) | b, alpha: a, width }
    }
    if (raw.startsWith('#')) {
      let hex = raw.slice(1)
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
      return { color: parseInt(hex, 16), alpha: 1, width }
    }
  }

  const theme = getPixiTheme()
  if (isFlow) return { color: theme.flow, alpha: 1, width }
  if (c.hasEvidence) return { color: theme.connectionEvidence, alpha: theme.connectionEvidenceAlpha, width }
  return { color: theme.connection, alpha: theme.connectionAlpha, width }
}

// ─── draw waypoints to Graphics ───────────────────────────────────────

interface Vec2 { x: number; y: number }

function drawWaypoints(gfx: Graphics, wp: Vec2[], cr: number) {
  if (wp.length < 2) return
  gfx.moveTo(wp[0].x, wp[0].y)
  for (let i = 1; i < wp.length; i++) {
    if (i < wp.length - 1) {
      const prev = wp[i - 1], curr = wp[i], next = wp[i + 1]
      let dx1 = curr.x - prev.x, dy1 = curr.y - prev.y
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1)
      let dx2 = next.x - curr.x, dy2 = next.y - curr.y
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)
      if (len1 < 0.5 || len2 < 0.5) { gfx.lineTo(curr.x, curr.y); continue }
      dx1 /= len1; dy1 /= len1
      dx2 /= len2; dy2 /= len2
      const r = Math.min(cr, len1 / 2, len2 / 2)
      gfx.lineTo(curr.x - dx1 * r, curr.y - dy1 * r)
      gfx.quadraticCurveTo(curr.x, curr.y, curr.x + dx2 * r, curr.y + dy2 * r)
    } else {
      gfx.lineTo(wp[i].x, wp[i].y)
    }
  }
}

// ─── build popup-routing waypoints ────────────────────────────────────

function buildTrackForPopup(
  sign: number,
  fxPx: number, fyPx: number, adjTxPx: number, adjTyPx: number,
  midXPx: number, midYPx: number,
  alongX: number, alongY: number, perpX: number, perpY: number,
  lenPx: number,
  popupSize: { w: number; h: number },
  gapProgress: number,
): Vec2[] {
  const padding = 16
  const hw = (popupSize.w / 2 + padding) * gapProgress
  const hh = (popupSize.h / 2 + padding) * gapProgress

  let t = Infinity
  if (Math.abs(alongX) > 1e-9) t = Math.min(t, hw / Math.abs(alongX))
  if (Math.abs(alongY) > 1e-9) t = Math.min(t, hh / Math.abs(alongY))
  t = Math.min(t, lenPx / 2 - 1)
  if (t <= 0) return [{ x: fxPx, y: fyPx }, { x: adjTxPx, y: adjTyPx }]

  const entAbs = { x: midXPx - alongX * t, y: midYPx - alongY * t }
  const extAbs = { x: midXPx + alongX * t, y: midYPx + alongY * t }

  const extRx = alongX * t
  const extRy = alongY * t
  const eps = 0.5
  let exitEdge: number
  if (Math.abs(extRx - hw) < eps) exitEdge = 1
  else if (Math.abs(extRx + hw) < eps) exitEdge = 3
  else if (Math.abs(extRy - hh) < eps) exitEdge = 2
  else exitEdge = 0
  const entryEdge = (exitEdge + 2) % 4

  const cornerPos: [number, number][] = [
    [midXPx - hw, midYPx - hh],
    [midXPx + hw, midYPx - hh],
    [midXPx + hw, midYPx + hh],
    [midXPx - hw, midYPx + hh],
  ]

  const cwIdx: number[] = []
  let e = entryEdge
  while (true) {
    cwIdx.push((e + 1) % 4)
    e = (e + 1) % 4
    if (e === exitEdge) break
  }
  const ccwIdx: number[] = []
  e = entryEdge
  while (true) {
    ccwIdx.push(e)
    e = (e - 1 + 4) % 4
    if (e === exitEdge) break
  }

  const cwPerp = cwIdx.reduce((s, ci) =>
    s + (cornerPos[ci][0] - midXPx) * perpX + (cornerPos[ci][1] - midYPx) * perpY, 0)
  const myIdx = (cwPerp * sign > 0) ? cwIdx : ccwIdx
  const myCorners = myIdx.map(ci => ({ x: cornerPos[ci][0], y: cornerPos[ci][1] }))

  if (myCorners.length === 0) {
    return [{ x: fxPx, y: fyPx }, { x: adjTxPx, y: adjTyPx }]
  }

  return [
    { x: fxPx, y: fyPx },
    entAbs,
    ...myCorners,
    extAbs,
    { x: adjTxPx, y: adjTyPx },
  ]
}

// ─── build fallback bow track ─────────────────────────────────────────

function buildFallbackBow(
  sign: number,
  gfx: Graphics,
  fxPx: number, fyPx: number, adjTxPx: number, adjTyPx: number,
  midXPx: number, midYPx: number,
  alongX: number, alongY: number, perpX: number, perpY: number,
  lenPx: number, gapProgress: number,
) {
  const bow = Math.min(lenPx * 0.18, 110) * gapProgress
  const cpx = midXPx + perpX * bow * sign
  const cpy = midYPx + perpY * bow * sign
  const sAx = fxPx + alongX * lenPx * 0.30
  const sAy = fyPx + alongY * lenPx * 0.30
  const sBx = fxPx + alongX * lenPx * 0.70
  const sBy = fyPx + alongY * lenPx * 0.70

  gfx.moveTo(fxPx, fyPx)
  gfx.lineTo(sAx, sAy)
  gfx.quadraticCurveTo(cpx, cpy, sBx, sBy)
  gfx.lineTo(adjTxPx, adjTyPx)
}

// ─── Public draw function ─────────────────────────────────────────────

export function drawUnzipConnection(gfx: Graphics, c: ConnectionRenderData) {
  gfx.clear()

  const { color, alpha, width } = resolveStroke(c)
  const hasArrow = (c.arrowStyle ?? 'standard') !== 'none'

  // NOTE: Unzip draws in *scene-pixel* space (using SCENE_W × SCENE_H),
  // matching PixiConnectionRenderer's coordinate system.
  const fxPx = c.fromX * SCENE_W / 100
  const fyPx = c.fromY * SCENE_H / 100
  const txPx = c.toX * SCENE_W / 100
  const tyPx = c.toY * SCENE_H / 100

  const dxPx = txPx - fxPx
  const dyPx = tyPx - fyPx
  const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
  if (lenPx < 1) return

  const alongX = dxPx / lenPx
  const alongY = dyPx / lenPx
  const perpX = -alongY
  const perpY = alongX

  // Shorten target end for arrowhead
  const arrowLenPx = 16
  let adjTxPx = txPx, adjTyPx = tyPx
  if (hasArrow && lenPx > arrowLenPx * 2) {
    adjTxPx = txPx - alongX * arrowLenPx
    adjTyPx = tyPx - alongY * arrowLenPx
  }

  const midXPx = (fxPx + txPx) / 2
  const midYPx = (fyPx + tyPx) / 2

  const hasPopup = c.popupSize && c.popupSize.w > 0 && c.popupSize.h > 0

  const strokeOpts = { color, alpha, width, cap: 'round' as const }

  if (hasPopup) {
    const wp1 = buildTrackForPopup(+1, fxPx, fyPx, adjTxPx, adjTyPx,
      midXPx, midYPx, alongX, alongY, perpX, perpY, lenPx, c.popupSize!, c.gapProgress)
    const cr = Math.min(
      (c.popupSize!.w / 2 + 16) * c.gapProgress,
      (c.popupSize!.h / 2 + 16) * c.gapProgress,
      28,
    )
    drawWaypoints(gfx, wp1, cr)
    gfx.stroke(strokeOpts)

    const wp2 = buildTrackForPopup(-1, fxPx, fyPx, adjTxPx, adjTyPx,
      midXPx, midYPx, alongX, alongY, perpX, perpY, lenPx, c.popupSize!, c.gapProgress)
    drawWaypoints(gfx, wp2, cr)
    gfx.stroke(strokeOpts)
  } else {
    buildFallbackBow(+1, gfx, fxPx, fyPx, adjTxPx, adjTyPx,
      midXPx, midYPx, alongX, alongY, perpX, perpY, lenPx, c.gapProgress)
    gfx.stroke(strokeOpts)

    buildFallbackBow(-1, gfx, fxPx, fyPx, adjTxPx, adjTyPx,
      midXPx, midYPx, alongX, alongY, perpX, perpY, lenPx, c.gapProgress)
    gfx.stroke(strokeOpts)
  }

  // Draw arrowhead on the primary track (sign=+1) only
  if (hasArrow && lenPx > arrowLenPx) {
    const arrowStyle = c.arrowStyle ?? 'standard'
    const pX = -alongY
    const pY = alongX

    switch (arrowStyle) {
      case 'standard':
      case 'triangle': {
        gfx.moveTo(txPx, tyPx)
        gfx.lineTo(txPx - alongX * 8 + pX * 3, tyPx - alongY * 8 + pY * 3)
        gfx.lineTo(txPx - alongX * 8 - pX * 3, tyPx - alongY * 8 - pY * 3)
        gfx.closePath()
        gfx.fill({ color, alpha })
        break
      }
      case 'diamond': {
        gfx.moveTo(txPx, tyPx)
        gfx.lineTo(txPx - alongX * 5 + pX * 4, tyPx - alongY * 5 + pY * 4)
        gfx.lineTo(txPx - alongX * 10, tyPx - alongY * 10)
        gfx.lineTo(txPx - alongX * 5 - pX * 4, tyPx - alongY * 5 - pY * 4)
        gfx.closePath()
        gfx.fill({ color, alpha })
        break
      }
      case 'circle': {
        gfx.circle(txPx - alongX * 4, tyPx - alongY * 4, 3.5)
        gfx.fill({ color, alpha })
        break
      }
    }
  }
}
