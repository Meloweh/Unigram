/**
 * PixiConnectionRenderer — imperative PixiJS renderer for all connections.
 *
 * Manages a pool of Graphics objects inside a PixiJS Container (connectionsLayer).
 * Draws: straight lines, arrowheads (5 styles), dash patterns, flow glow,
 * labels, hit areas for click detection, and the connection draft line.
 *
 * Unzipping connections (bow paths) are handled by PixiUnzipConnection.
 */
import { Graphics, Text, Container, FederatedPointerEvent, Polygon } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import { getPixiTheme } from './pixiThemeBridge'
import type { ConnectionArrowStyle, ConnectionDashStyle, ConnectionType, ModelConnection } from '../model/sampleModels'
import type { Anchor } from './edgeAnchoring'
import { drawUnzipConnection } from './PixiUnzipConnection'

// ─── Types ────────────────────────────────────────────────────────────

export interface ConnectionRenderData {
  key: string
  fromX: number; fromY: number
  toX: number; toY: number
  hasEvidence: boolean
  connectionType?: ConnectionType
  flowProgress?: number
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: ConnectionDashStyle
  arrowStyle?: ConnectionArrowStyle
  label?: string
  labelFontSize?: number
  /** Unzip state — if non-zero, this connection is being unzipped */
  gapProgress: number
  popupSize: { w: number; h: number } | null
  connectionAngle: number
}

// ─── Pooled display objects per connection key ────────────────────────

interface ConnectionEntry {
  gfx: Graphics          // Main line + arrowhead
  flowGfx: Graphics | null // Flow animation overlay
  label: Text | null
  hitGfx: Graphics        // Invisible thick hit area
  container: Container
  // State cache for diffing — skip redraw when nothing changed
  lastFromX: number; lastFromY: number
  lastToX: number; lastToY: number
  lastFlowProgress: number | undefined
  lastStrokeColor: string | undefined
  lastStrokeWidth: number | undefined
  lastStrokeDash: ConnectionDashStyle | undefined
  lastArrowStyle: ConnectionArrowStyle | undefined
  lastGapProgress: number
  lastLabel: string | undefined
}

const pool = new Map<string, ConnectionEntry>()
let draftGfx: Graphics | null = null

// ─── Resolve color ────────────────────────────────────────────────────

function resolveColor(c: ConnectionRenderData): { color: number; alpha: number } {
  if (c.strokeColor) {
    // Parse custom color
    const raw = c.strokeColor.trim()
    const rgbaMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
    if (rgbaMatch) {
      const r = parseInt(rgbaMatch[1])
      const g = parseInt(rgbaMatch[2])
      const b = parseInt(rgbaMatch[3])
      const a = rgbaMatch[4] != null ? parseFloat(rgbaMatch[4]) : 1
      return { color: (r << 16) | (g << 8) | b, alpha: a }
    }
    if (raw.startsWith('#')) {
      let hex = raw.slice(1)
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
      return { color: parseInt(hex, 16), alpha: 1 }
    }
  }
  const theme = getPixiTheme()
  if (c.connectionType === 'flow') return { color: theme.flow, alpha: 1 }
  if (c.hasEvidence) return { color: theme.connectionEvidence, alpha: theme.connectionEvidenceAlpha }
  return { color: theme.connection, alpha: theme.connectionAlpha }
}

// ─── Dash patterns ────────────────────────────────────────────────────

function getDashArray(c: ConnectionRenderData): number[] | null {
  if (c.hasEvidence && (!c.strokeDash || c.strokeDash === 'solid')) return [6, 3]
  if (c.strokeDash && c.strokeDash !== 'solid') {
    const map: Record<string, number[]> = {
      dashed: [8, 4], dotted: [2, 4], 'dash-dot': [8, 4, 2, 4],
    }
    return map[c.strokeDash] ?? null
  }
  return null
}

// ─── Draw arrowhead ───────────────────────────────────────────────────

function drawArrowhead(
  gfx: Graphics,
  tipX: number, tipY: number,
  ux: number, uy: number,
  color: number, alpha: number,
  style: ConnectionArrowStyle,
) {
  const perpX = -uy
  const perpY = ux

  switch (style) {
    case 'standard':
    case 'triangle': {
      gfx.moveTo(tipX, tipY)
      gfx.lineTo(tipX - ux * 8 + perpX * 3, tipY - uy * 8 + perpY * 3)
      gfx.lineTo(tipX - ux * 8 - perpX * 3, tipY - uy * 8 - perpY * 3)
      gfx.closePath()
      gfx.fill({ color, alpha })
      if (style === 'triangle') {
        gfx.stroke({ color, alpha, width: 0.5 })
      }
      break
    }
    case 'diamond': {
      gfx.moveTo(tipX, tipY)
      gfx.lineTo(tipX - ux * 5 + perpX * 4, tipY - uy * 5 + perpY * 4)
      gfx.lineTo(tipX - ux * 10, tipY - uy * 10)
      gfx.lineTo(tipX - ux * 5 - perpX * 4, tipY - uy * 5 - perpY * 4)
      gfx.closePath()
      gfx.fill({ color, alpha })
      break
    }
    case 'circle': {
      gfx.circle(tipX - ux * 4, tipY - uy * 4, 3.5)
      gfx.fill({ color, alpha })
      break
    }
    // 'none' — no arrowhead
  }
}

// ─── Draw a single straight connection ────────────────────────────────

function drawStraightConnection(entry: ConnectionEntry, c: ConnectionRenderData) {
  const gfx = entry.gfx
  gfx.clear()

  const { color, alpha } = resolveColor(c)
  const isFlow = c.connectionType === 'flow'
  const sw = c.strokeWidth ?? (isFlow ? 3 : 2)
  const arrowStyle = c.arrowStyle ?? 'standard'
  const hasArrow = arrowStyle !== 'none'

  // Convert from %-coords to scene-pixel coords
  const fxPx = c.fromX * SCENE_W / 100
  const fyPx = c.fromY * SCENE_H / 100
  const txPx = c.toX * SCENE_W / 100
  const tyPx = c.toY * SCENE_H / 100

  const dxPx = txPx - fxPx
  const dyPx = tyPx - fyPx
  const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx)
  if (lenPx < 0.5) return

  const ux = dxPx / lenPx
  const uy = dyPx / lenPx

  // Shorten line by arrowhead length
  const arrowLen = hasArrow ? 8 * sw : 0
  let adjTxPx = txPx, adjTyPx = tyPx
  if (hasArrow && lenPx > arrowLen * 2) {
    const ratio = arrowLen / lenPx
    adjTxPx = txPx - dxPx * ratio
    adjTyPx = tyPx - dyPx * ratio
  }

  // Main line
  const dash = getDashArray(c)

  gfx.moveTo(fxPx, fyPx)
  gfx.lineTo(adjTxPx, adjTyPx)
  gfx.stroke({
    color,
    alpha,
    width: sw,
    cap: 'round',
    ...(dash ? { dash } : {}),
  })

  // Arrowhead
  if (hasArrow && lenPx > arrowLen) {
    drawArrowhead(gfx, txPx, tyPx, ux, uy, color, alpha, arrowStyle)
  }

  // Flow animation glow
  if (isFlow && c.flowProgress != null && c.flowProgress > 0) {
    const flowGfx = entry.flowGfx ?? new Graphics()
    entry.flowGfx = flowGfx
    if (!flowGfx.parent) entry.container.addChild(flowGfx)
    flowGfx.clear()

    const theme = getPixiTheme()
    const progTxPx = fxPx + dxPx * c.flowProgress
    const progTyPx = fyPx + dyPx * c.flowProgress
    flowGfx.moveTo(fxPx, fyPx)
    flowGfx.lineTo(progTxPx, progTyPx)
    flowGfx.stroke({ color: theme.flowAnim, width: 5, alpha: 0.7, cap: 'round' })
  } else if (entry.flowGfx) {
    entry.flowGfx.clear()
  }

  // Hit area — fat invisible polygon for click detection
  const hitGfx = entry.hitGfx
  hitGfx.clear()
  const hitHalf = 8 // 16px total hit area width
  const px = -uy, py = ux
  hitGfx.moveTo(fxPx + px * hitHalf, fyPx + py * hitHalf)
  hitGfx.lineTo(txPx + px * hitHalf, tyPx + py * hitHalf)
  hitGfx.lineTo(txPx - px * hitHalf, tyPx - py * hitHalf)
  hitGfx.lineTo(fxPx - px * hitHalf, fyPx - py * hitHalf)
  hitGfx.closePath()
  hitGfx.fill({ color: 0x000000, alpha: 0.001 }) // nearly invisible

  // Label
  if (c.label) {
    const midXPx = (fxPx + txPx) / 2
    const midYPx = (fyPx + tyPx) / 2
    if (!entry.label) {
      entry.label = new Text({ text: '', style: { fontSize: 13, fill: 0x4a6e90 } })
      entry.label.anchor.set(0.5, 0.5)
      entry.container.addChild(entry.label)
    }
    entry.label.text = c.label
    entry.label.style.fontSize = (c.labelFontSize ?? 0.85) * 16
    entry.label.position.set(midXPx, midYPx)
    entry.label.visible = true
  } else if (entry.label) {
    entry.label.visible = false
  }
}

// ─── Sync function — called from React ────────────────────────────────

export function syncConnections(
  layer: Container,
  connections: ConnectionRenderData[],
  onClickConnection: (connectionKey: string, anchorX: number, anchorY: number) => void,
) {
  const usedKeys = new Set<string>()

  for (const c of connections) {
    usedKeys.add(c.key)
    let entry = pool.get(c.key)

    if (!entry) {
      const container = new Container()
      const gfx = new Graphics()
      const hitGfx = new Graphics()
      hitGfx.eventMode = 'static'
      hitGfx.cursor = 'pointer'
      const connKey = c.key
      const midXRef = { v: 0 }
      const midYRef = { v: 0 }
      hitGfx.on('click', (ev: FederatedPointerEvent) => {
        ev.stopPropagation()
        onClickConnection(connKey, midXRef.v, midYRef.v)
      })
      container.addChild(gfx)
      container.addChild(hitGfx)
      layer.addChild(container)
      entry = {
        gfx, flowGfx: null, label: null, hitGfx, container,
        lastFromX: NaN, lastFromY: NaN, lastToX: NaN, lastToY: NaN,
        lastFlowProgress: undefined, lastStrokeColor: undefined,
        lastStrokeWidth: undefined, lastStrokeDash: undefined,
        lastArrowStyle: undefined, lastGapProgress: -1, lastLabel: undefined,
      }
      // Store midpoint refs on the entry so click handler reads latest values
      ;(entry as any)._midX = midXRef
      ;(entry as any)._midY = midYRef
      pool.set(c.key, entry)
    }

    // Update midpoint refs for click handler
    const midX = (c.fromX + c.toX) / 2
    const midY = (c.fromY + c.toY) / 2
    ;(entry as any)._midX.v = midX
    ;(entry as any)._midY.v = midY

    // Diff — skip redraw if nothing changed
    const needsRedraw =
      entry.lastFromX !== c.fromX || entry.lastFromY !== c.fromY ||
      entry.lastToX !== c.toX || entry.lastToY !== c.toY ||
      entry.lastFlowProgress !== c.flowProgress ||
      entry.lastStrokeColor !== c.strokeColor ||
      entry.lastStrokeWidth !== c.strokeWidth ||
      entry.lastStrokeDash !== c.strokeDash ||
      entry.lastArrowStyle !== c.arrowStyle ||
      entry.lastGapProgress !== c.gapProgress ||
      entry.lastLabel !== c.label

    if (!needsRedraw) continue

    entry.lastFromX = c.fromX; entry.lastFromY = c.fromY
    entry.lastToX = c.toX; entry.lastToY = c.toY
    entry.lastFlowProgress = c.flowProgress
    entry.lastStrokeColor = c.strokeColor
    entry.lastStrokeWidth = c.strokeWidth
    entry.lastStrokeDash = c.strokeDash
    entry.lastArrowStyle = c.arrowStyle
    entry.lastGapProgress = c.gapProgress
    entry.lastLabel = c.label

    if (c.gapProgress >= 0.001) {
      // Unzipping — delegate to PixiUnzipConnection
      drawUnzipConnection(entry.gfx, c)
      entry.hitGfx.clear()
      if (entry.flowGfx) entry.flowGfx.clear()
      if (entry.label) entry.label.visible = false
    } else {
      drawStraightConnection(entry, c)
    }
  }

  // Remove stale entries
  for (const [key, entry] of pool.entries()) {
    if (!usedKeys.has(key)) {
      entry.container.destroy({ children: true })
      pool.delete(key)
    }
  }
}

// ─── Draft connection line ────────────────────────────────────────────

export function syncDraftLine(
  layer: Container,
  draft: { fromX: number; fromY: number; toX: number; toY: number; connectionType?: ConnectionType } | null,
) {
  if (!draft) {
    if (draftGfx) { draftGfx.clear() }
    return
  }

  if (!draftGfx) {
    draftGfx = new Graphics()
    layer.addChild(draftGfx)
  }

  draftGfx.clear()
  const theme = getPixiTheme()
  const isFlow = draft.connectionType === 'flow'
  const color = isFlow ? theme.flow : theme.connectionDraft
  const alpha = isFlow ? 1 : theme.connectionDraftAlpha

  const fxPx = draft.fromX * SCENE_W / 100
  const fyPx = draft.fromY * SCENE_H / 100
  const txPx = draft.toX * SCENE_W / 100
  const tyPx = draft.toY * SCENE_H / 100

  draftGfx.moveTo(fxPx, fyPx)
  draftGfx.lineTo(txPx, tyPx)
  draftGfx.stroke({ color, alpha, width: 2, dash: [6, 4] })
}

// ─── Cleanup on unmount ───────────────────────────────────────────────

export function destroyAllConnections() {
  for (const [, entry] of pool.entries()) {
    entry.container.destroy({ children: true })
  }
  pool.clear()
  if (draftGfx) {
    draftGfx.destroy()
    draftGfx = null
  }
}
