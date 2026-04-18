/**
 * PixiNodeRenderer — renders node backgrounds, borders, shadows, selection glow,
 * multi-select outlines, flow-active pulse, and static label text for all
 * non-cosmetic "standard" nodes at LOD_FULL.
 *
 * Nodes with mediaType or cosmeticType are handled by React SceneNode instead.
 * Interaction is handled via thin DOM hit-area divs (kept in ModelSceneContent).
 */
import { Graphics, Text, Container, FillGradient } from 'pixi.js'
import { SCENE_W, SCENE_H, NODE_MIN_W, NODE_MIN_H } from './sceneConstants'
import { parseColor, getPixiTheme } from './pixiThemeBridge'
import { pixiNodeMap } from './pixiNodeMap'

// ─── Types ────────────────────────────────────────────────────────────

export interface FullNodeData {
  id: string
  x: number          // percentage 0-100
  y: number          // percentage 0-100
  label: string
  shape: string      // 'rounded-rect' | 'rectangle' | 'oval' | 'circle' | 'diamond' | 'hexagon' | 'parallelogram' | 'triangle'
  cellColor: string
  membraneColor: string
  membraneVisible: boolean
  nodeWidth?: number
  nodeHeight?: number
  isSelected: boolean
  isMultiSelected: boolean
  isFlowActive: boolean
  isFlowRunning: boolean
  isEditing: boolean
  chromeFade: number  // 1 normally, fades to 0 during zoom
}

// ─── Constants ────────────────────────────────────────────────────────

const LABEL_PAD_W = 36   // 18px each side
const LABEL_PAD_H = 32   // 16px each side
const BORDER_WIDTH = 2
const SHADOW_OFFSET_Y = 10
const SHADOW_ALPHA = 0.2
const SHADOW_COLOR = 0x132949
const SELECTION_COLOR = 0x0e4f8f  // rgba(14,79,143)
const MULTI_SELECT_COLOR = 0x2563eb
const GLOW_AMBER = 0xf59e0b      // used for selection/flow glow

// ─── Pool ─────────────────────────────────────────────────────────────

interface NodeEntry {
  container: Container
  shadowGfx: Graphics
  glowGfx: Graphics
  bgGfx: Graphics
  borderGfx: Graphics
  multiSelectGfx: Graphics
  labelText: Text
  // State cache for diffing
  lastCellColor: string
  lastMembraneColor: string
  lastShape: string
  lastW: number
  lastH: number
  lastLabel: string
  lastSelected: boolean
  lastMultiSelected: boolean
  lastChromeFade: number
  lastEditing: boolean
  lastFlowActive: boolean
  // Computed sizes
  effectiveW: number
  effectiveH: number
}

const pool = new Map<string, NodeEntry>()

// ─── Gradient helpers ─────────────────────────────────────────────────

/** Compute darker gradient end color: R-21, G-15, B-8 */
function darkerEnd(r: number, g: number, b: number) {
  return { r: Math.max(0, r - 21), g: Math.max(0, g - 15), b: Math.max(0, b - 8) }
}

/** Parse hex string to {r,g,b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const { color } = parseColor(hex)
  return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff }
}

function rgbToHex(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

function createGradient(w: number, h: number, cellColor: string): FillGradient {
  const rgb = hexToRgb(cellColor)
  const end = darkerEnd(rgb.r, rgb.g, rgb.b)

  // 145deg CSS gradient → direction (sin(145°), -cos(145°)) ≈ (0.574, 0.819)
  const dx = 0.574, dy = 0.819
  const cx = w / 2, cy = h / 2
  const halfLen = Math.abs(dx * w / 2) + Math.abs(dy * h / 2)

  const gradient = new FillGradient({
    x0: cx - dx * halfLen,
    y0: cy - dy * halfLen,
    x1: cx + dx * halfLen,
    y1: cy + dy * halfLen,
  })
  gradient.addColorStop(0, rgbToHex(rgb.r, rgb.g, rgb.b))
  gradient.addColorStop(1, rgbToHex(end.r, end.g, end.b))
  return gradient
}

// ─── Shape drawing helpers ────────────────────────────────────────────

function drawShape(gfx: Graphics, shape: string, w: number, h: number, radius: number, ox = 0, oy = 0) {
  switch (shape) {
    case 'rectangle':
      gfx.rect(ox, oy, w, h)
      break
    case 'oval':
    case 'circle':
      gfx.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2)
      break
    case 'diamond':
      gfx.moveTo(ox + w / 2, oy)
      gfx.lineTo(ox + w, oy + h / 2)
      gfx.lineTo(ox + w / 2, oy + h)
      gfx.lineTo(ox, oy + h / 2)
      gfx.closePath()
      break
    case 'hexagon':
      gfx.moveTo(ox + w * 0.25, oy)
      gfx.lineTo(ox + w * 0.75, oy)
      gfx.lineTo(ox + w, oy + h * 0.5)
      gfx.lineTo(ox + w * 0.75, oy + h)
      gfx.lineTo(ox + w * 0.25, oy + h)
      gfx.lineTo(ox, oy + h * 0.5)
      gfx.closePath()
      break
    case 'parallelogram':
      gfx.moveTo(ox + w * 0.15, oy)
      gfx.lineTo(ox + w, oy)
      gfx.lineTo(ox + w * 0.85, oy + h)
      gfx.lineTo(ox, oy + h)
      gfx.closePath()
      break
    case 'triangle':
      gfx.moveTo(ox + w / 2, oy)
      gfx.lineTo(ox + w, oy + h)
      gfx.lineTo(ox, oy + h)
      gfx.closePath()
      break
    default: // 'rounded-rect'
      gfx.roundRect(ox, oy, w, h, radius)
      break
  }
}

// ─── Compute node size from label ─────────────────────────────────────

function computeNodeSize(
  data: FullNodeData,
  labelText: Text,
): { w: number; h: number } {
  const measuredW = Math.max(NODE_MIN_W, labelText.width + LABEL_PAD_W)
  const measuredH = Math.max(NODE_MIN_H, labelText.height + LABEL_PAD_H)
  let w = data.nodeWidth ?? measuredW
  let h = data.nodeHeight ?? measuredH
  // Circle enforces equal dims
  if (data.shape === 'circle') {
    const dim = Math.max(w, h)
    w = dim
    h = dim
  }
  return { w, h }
}

// ─── Draw a single node entry ─────────────────────────────────────────

function updateNodeEntry(entry: NodeEntry, data: FullNodeData): boolean {
  const theme = getPixiTheme()

  // Update label text
  if (entry.lastLabel !== data.label || entry.lastEditing !== data.isEditing) {
    entry.lastLabel = data.label
    entry.lastEditing = data.isEditing
    entry.labelText.text = data.label
    // Hide label when editing (DOM textarea shows instead)
    entry.labelText.visible = !data.isEditing && data.chromeFade > 0.01
  }

  // Compute effective size
  const { w, h } = computeNodeSize(data, entry.labelText)
  const sizeChanged = w !== entry.effectiveW || h !== entry.effectiveH
  entry.effectiveW = w
  entry.effectiveH = h

  // Position in scene-pixel coords (centered on the coordinate)
  const xPx = data.x * SCENE_W / 100 - w / 2
  const yPx = data.y * SCENE_H / 100 - h / 2
  entry.container.position.set(xPx, yPx)

  // Fade during zoom
  entry.container.alpha = data.chromeFade

  const needsRedraw =
    entry.lastCellColor !== data.cellColor ||
    entry.lastMembraneColor !== data.membraneColor ||
    entry.lastShape !== data.shape ||
    entry.lastW !== w ||
    entry.lastH !== h ||
    entry.lastSelected !== data.isSelected ||
    entry.lastMultiSelected !== data.isMultiSelected ||
    entry.lastChromeFade !== data.chromeFade ||
    entry.lastFlowActive !== data.isFlowActive

  if (!needsRedraw) return sizeChanged

  entry.lastCellColor = data.cellColor
  entry.lastMembraneColor = data.membraneColor
  entry.lastShape = data.shape
  entry.lastW = w
  entry.lastH = h
  entry.lastSelected = data.isSelected
  entry.lastMultiSelected = data.isMultiSelected
  entry.lastChromeFade = data.chromeFade
  entry.lastFlowActive = data.isFlowActive

  const radius = data.shape === 'rectangle' ? 0 : 18
  const { color: memColor } = parseColor(data.membraneColor)

  // ── Shadow (single semi-transparent shape — lightweight) ──
  entry.shadowGfx.clear()
  if (data.chromeFade > 0.01) {
    const spread = 6
    const yOff = SHADOW_OFFSET_Y
    drawShape(entry.shadowGfx, data.shape, w + spread * 2, h + spread * 2, radius + spread, -spread, yOff - spread)
    entry.shadowGfx.fill({ color: SHADOW_COLOR, alpha: SHADOW_ALPHA * data.chromeFade })
  }

  // ── Selection / Flow glow (simple filled shape — no BlurFilter) ──
  entry.glowGfx.clear()
  const showGlow = (data.isSelected && !data.isFlowRunning) || data.isFlowActive
  if (showGlow && data.chromeFade > 0.01) {
    // Outer soft halo (larger, more transparent)
    const outerPad = 10
    drawShape(entry.glowGfx, data.shape, w + outerPad * 2, h + outerPad * 2, radius + outerPad, -outerPad, -outerPad)
    entry.glowGfx.fill({ color: GLOW_AMBER, alpha: 0.15 })
    // Inner glow (tighter, brighter)
    const innerPad = 4
    drawShape(entry.glowGfx, data.shape, w + innerPad * 2, h + innerPad * 2, radius + innerPad, -innerPad, -innerPad)
    entry.glowGfx.fill({ color: GLOW_AMBER, alpha: 0.30 })
    entry.glowGfx.visible = true
  } else {
    entry.glowGfx.visible = false
  }

  // ── Background gradient fill ──
  entry.bgGfx.clear()
  const gradient = createGradient(w, h, data.cellColor)
  drawShape(entry.bgGfx, data.shape, w, h, radius)
  entry.bgGfx.fill(gradient)

  // ── Border ──
  entry.borderGfx.clear()
  if (data.chromeFade > 0.01) {
    const borderColor = data.isSelected
      ? SELECTION_COLOR
      : data.membraneVisible ? memColor : 0x000000
    const borderAlpha = data.isSelected
      ? data.chromeFade
      : data.membraneVisible ? data.chromeFade : 0

    if (borderAlpha > 0) {
      drawShape(entry.borderGfx, data.shape, w, h, radius)
      entry.borderGfx.stroke({ color: borderColor, alpha: borderAlpha, width: BORDER_WIDTH })
    }
  }

  // ── Multi-select dashed outline ──
  entry.multiSelectGfx.clear()
  if (data.isMultiSelected && data.chromeFade > 0.01) {
    const pad = 3
    entry.multiSelectGfx.position.set(-pad, -pad)
    drawShape(entry.multiSelectGfx, data.shape, w + pad * 2, h + pad * 2, radius + pad)
    entry.multiSelectGfx.stroke({
      color: MULTI_SELECT_COLOR,
      alpha: 0.7 * data.chromeFade,
      width: 2,
      dash: [6, 4],
    })
  }

  // ── Label position (centered in node) ──
  entry.labelText.position.set(w / 2, h / 2)
  entry.labelText.style.fill = theme.text

  return sizeChanged
}

// ─── Sync ─────────────────────────────────────────────────────────────

export function syncFullNodes(
  layer: Container,
  nodes: FullNodeData[],
  onSizeChanged: (id: string, size: { w: number; h: number }) => void,
) {
  const usedIds = new Set<string>()
  const theme = getPixiTheme()

  for (const data of nodes) {
    usedIds.add(data.id)
    let entry = pool.get(data.id)

    if (!entry) {
      const container = new Container()
      const shadowGfx = new Graphics()
      const glowGfx = new Graphics()
      const bgGfx = new Graphics()
      const borderGfx = new Graphics()
      const multiSelectGfx = new Graphics()
      const labelText = new Text({
        text: '',
        style: {
          fontSize: 14,
          fill: theme.text,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          wordWrap: false,
          align: 'center',
        },
      })
      labelText.anchor.set(0.5, 0.5)

      // Z-order: shadow → glow → bg → border → multi-select → label
      container.addChild(shadowGfx)
      container.addChild(glowGfx)
      container.addChild(bgGfx)
      container.addChild(borderGfx)
      container.addChild(multiSelectGfx)
      container.addChild(labelText)

      layer.addChild(container)

      entry = {
        container, shadowGfx, glowGfx, bgGfx, borderGfx, multiSelectGfx, labelText,
        lastCellColor: '', lastMembraneColor: '', lastShape: '',
        lastW: 0, lastH: 0, lastLabel: '\0', lastSelected: false,
        lastMultiSelected: false, lastChromeFade: -1, lastEditing: false,
        lastFlowActive: false,
        effectiveW: NODE_MIN_W, effectiveH: NODE_MIN_H,
      }
      pool.set(data.id, entry)
      pixiNodeMap.set(data.id, container)
    }

    const sizeChanged = updateNodeEntry(entry, data)
    if (sizeChanged) {
      onSizeChanged(data.id, { w: entry.effectiveW, h: entry.effectiveH })
    }
  }

  // Remove stale
  for (const [id, entry] of pool.entries()) {
    if (!usedIds.has(id)) {
      entry.container.destroy({ children: true })
      pool.delete(id)
      pixiNodeMap.delete(id)
    }
  }
}

// ─── Glow pulse animation — call from PixiJS ticker ──────────────────

export function tickNodeAnimations() {
  const t = performance.now() / 1000
  for (const [, entry] of pool.entries()) {
    if (entry.glowGfx.visible) {
      // Sine pulse: 1.5s period, alpha oscillates 0.2..0.5
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 1.5)
      entry.glowGfx.alpha = 0.2 + 0.3 * pulse
    }
  }
}

// ─── Query node size ──────────────────────────────────────────────────

export function getPixiNodeSize(id: string): { w: number; h: number } | null {
  const entry = pool.get(id)
  if (!entry) return null
  return { w: entry.effectiveW, h: entry.effectiveH }
}

// ─── Hit-testing — returns node ID under scene-pixel coords ───────────

export function hitTestPixiNode(scenePxX: number, scenePxY: number): string | null {
  // Iterate in reverse insertion order so top-most (last added) wins
  let hitId: string | null = null
  for (const [id, entry] of pool.entries()) {
    if (!entry.container.visible) continue
    const cx = entry.container.x
    const cy = entry.container.y
    if (
      scenePxX >= cx && scenePxX <= cx + entry.effectiveW &&
      scenePxY >= cy && scenePxY <= cy + entry.effectiveH
    ) {
      hitId = id // later entries overwrite earlier ones (higher z)
    }
  }
  return hitId
}

// ─── Viewport culling — called from PixiJS ticker ─────────────────────

export function cullFullNodes(minPx: number, maxPx: number, minPy: number, maxPy: number) {
  for (const [, entry] of pool.entries()) {
    const cx = entry.container.x + entry.effectiveW / 2
    const cy = entry.container.y + entry.effectiveH / 2
    entry.container.visible = cx >= minPx && cx <= maxPx && cy >= minPy && cy <= maxPy
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────

export function destroyAllFullNodes() {
  for (const [id, entry] of pool.entries()) {
    entry.container.destroy({ children: true })
    pixiNodeMap.delete(id)
  }
  pool.clear()
}
