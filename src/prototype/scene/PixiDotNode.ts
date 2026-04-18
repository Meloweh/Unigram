/**
 * PixiDotNode — renders an 8×8 colored circle on the PixiJS nodesLayer
 * for nodes at the lowest LOD level (scale < LOD_SIMPLE).
 */
import { Graphics, Container } from 'pixi.js'
import { SCENE_W, SCENE_H } from './sceneConstants'
import { parseColor } from './pixiThemeBridge'
import { pixiNodeMap } from './pixiNodeMap'

const DOT_RADIUS = 4

interface DotEntry {
  container: Container
  gfx: Graphics
  lastColor: string
}

const pool = new Map<string, DotEntry>()

export function syncDotNodes(
  layer: Container,
  dots: { id: string; x: number; y: number; cellColor: string }[],
) {
  const usedIds = new Set<string>()

  for (const dot of dots) {
    usedIds.add(dot.id)
    let entry = pool.get(dot.id)

    if (!entry) {
      const container = new Container()
      const gfx = new Graphics()
      container.addChild(gfx)
      container.eventMode = 'static'
      container.cursor = 'pointer'
      layer.addChild(container)
      entry = { container, gfx, lastColor: '' }
      pool.set(dot.id, entry)
      pixiNodeMap.set(dot.id, container)
    }

    // Position in scene-pixel coords
    entry.container.position.set(
      dot.x * SCENE_W / 100,
      dot.y * SCENE_H / 100,
    )

    // Redraw only if color changed
    if (entry.lastColor !== dot.cellColor) {
      entry.lastColor = dot.cellColor
      const { color, alpha } = parseColor(dot.cellColor)
      entry.gfx.clear()
      entry.gfx.circle(0, 0, DOT_RADIUS)
      entry.gfx.fill({ color, alpha })
    }
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

export function cullDotNodes(minPx: number, maxPx: number, minPy: number, maxPy: number) {
  for (const [, entry] of pool.entries()) {
    const cx = entry.container.x
    const cy = entry.container.y
    entry.container.visible = cx >= minPx && cx <= maxPx && cy >= minPy && cy <= maxPy
  }
}

export function destroyAllDotNodes() {
  for (const [id, entry] of pool.entries()) {
    entry.container.destroy({ children: true })
    pixiNodeMap.delete(id)
  }
  pool.clear()
}
