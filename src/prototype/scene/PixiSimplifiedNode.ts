/**
 * PixiSimplifiedNode — renders a colored rounded rect + truncated label
 * on the PixiJS nodesLayer for nodes at medium LOD (LOD_SIMPLE ≤ scale < LOD_FULL).
 */
import { Graphics, Text, Container } from 'pixi.js'
import { SCENE_W, SCENE_H, NODE_MIN_W, NODE_MIN_H } from './sceneConstants'
import { parseColor, getPixiTheme } from './pixiThemeBridge'
import { pixiNodeMap } from './pixiNodeMap'

const BORDER_RADIUS = 8
const BORDER_WIDTH = 2
const MAX_LABEL_CHARS = 30

interface SimplifiedEntry {
  container: Container
  bgGfx: Graphics
  label: Text
  lastCellColor: string
  lastMembraneColor: string
  lastW: number
  lastH: number
  lastLabel: string
}

const pool = new Map<string, SimplifiedEntry>()

export interface SimplifiedNodeData {
  id: string
  x: number
  y: number
  cellColor: string
  membraneColor: string
  w: number
  h: number
  label: string
}

export function syncSimplifiedNodes(
  layer: Container,
  nodes: SimplifiedNodeData[],
) {
  const usedIds = new Set<string>()
  const theme = getPixiTheme()

  for (const n of nodes) {
    usedIds.add(n.id)
    let entry = pool.get(n.id)

    if (!entry) {
      const container = new Container()
      const bgGfx = new Graphics()
      const label = new Text({
        text: '',
        style: {
          fontSize: 11,
          fill: theme.text,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          wordWrap: false,
        },
      })
      container.addChild(bgGfx)
      container.addChild(label)
      container.eventMode = 'static'
      container.cursor = 'pointer'
      layer.addChild(container)
      entry = {
        container, bgGfx, label,
        lastCellColor: '', lastMembraneColor: '',
        lastW: 0, lastH: 0, lastLabel: '',
      }
      pool.set(n.id, entry)
      pixiNodeMap.set(n.id, container)
    }

    // Position — center the node (translate(-50%, -50%) equivalent)
    const xPx = n.x * SCENE_W / 100
    const yPx = n.y * SCENE_H / 100
    entry.container.position.set(xPx - n.w / 2, yPx - n.h / 2)

    // Redraw background if color or size changed
    const needsRedraw = entry.lastCellColor !== n.cellColor
      || entry.lastMembraneColor !== n.membraneColor
      || entry.lastW !== n.w
      || entry.lastH !== n.h

    if (needsRedraw) {
      entry.lastCellColor = n.cellColor
      entry.lastMembraneColor = n.membraneColor
      entry.lastW = n.w
      entry.lastH = n.h

      const { color: cellColor, alpha: cellAlpha } = parseColor(n.cellColor)
      const { color: borderColor, alpha: borderAlpha } = parseColor(n.membraneColor)

      const gfx = entry.bgGfx
      gfx.clear()

      // Fill
      gfx.roundRect(0, 0, n.w, n.h, BORDER_RADIUS)
      gfx.fill({ color: cellColor, alpha: cellAlpha })

      // Border
      gfx.roundRect(0, 0, n.w, n.h, BORDER_RADIUS)
      gfx.stroke({ color: borderColor, alpha: borderAlpha, width: BORDER_WIDTH })
    }

    // Update label if changed
    const truncated = n.label.slice(0, MAX_LABEL_CHARS)
    if (entry.lastLabel !== truncated) {
      entry.lastLabel = truncated
      entry.label.text = truncated
      entry.label.style.fill = theme.text
    }
    // Position label inside the rect with padding
    entry.label.position.set(6, 4)
  }

  // Remove stale entries
  for (const [id, entry] of pool.entries()) {
    if (!usedIds.has(id)) {
      entry.container.destroy({ children: true })
      pool.delete(id)
      pixiNodeMap.delete(id)
    }
  }
}

export function destroyAllSimplifiedNodes() {
  for (const [id, entry] of pool.entries()) {
    entry.container.destroy({ children: true })
    pixiNodeMap.delete(id)
  }
  pool.clear()
}
