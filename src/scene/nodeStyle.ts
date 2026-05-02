/**
 * Node visual style helpers shared by the renderer.
 *
 * Phase A of the parity catch-up — restore the per-node "weight" the legacy
 * app got from `linear-gradient(145deg, cellColor, slightlyDarker)` and a
 * system-font label, without sacrificing the GPU scene-graph contract.
 *
 * `FillGradient` instances are cached per cell-colour. Cache uses
 * `textureSpace: 'local'`, so the same gradient instance fits every node
 * size — keys never include `w`/`h`.
 */

import { FillGradient } from 'pixi.js'

/** Matches the legacy CSS body font stack. */
export const NODE_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/** Default label font size in scene pixels. Tuned to feel close to legacy 0.95rem. */
export const NODE_FONT_SIZE = 28

/** Default label fill colour (matches legacy `--ug-text`). */
export const NODE_LABEL_FILL = 0x132949

/** Membrane (border) width in scene pixels. */
export const NODE_STROKE_WIDTH = 3

/** Minimum node size in scene-percent units (legacy 80×40 px @ 1920×1080). */
export const NODE_MIN_W = (80 / 1920) * 100
export const NODE_MIN_H = (40 / 1080) * 100

/* ----- gradient cache ---------------------------------------------------- */

/** Parse `#rrggbb` into integer rgb components. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').padEnd(6, '0')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

/** Pack rgb into a `0xRRGGBB` integer for Pixi colour APIs. */
function rgbToInt(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b
}

/** Legacy-matching gradient end: r-21, g-15, b-8 from the cell colour. */
function gradientEndOf(cellHex: string): number {
  const { r, g, b } = hexToRgb(cellHex)
  return rgbToInt(
    Math.max(0, r - 21),
    Math.max(0, g - 15),
    Math.max(0, b - 8),
  )
}

const GRADIENT_CACHE_LIMIT = 64
const gradientCache = new Map<string, FillGradient>()

/**
 * Return a cached `FillGradient` for the given cell colour. The gradient is
 * a 145°-ish (top-left → bottom-right) linear gradient from `cellHex` to a
 * slightly darker derivative, configured in `local` texture space so the
 * same instance fits any node bbox.
 */
export function nodeFillGradient(cellHex: string): FillGradient {
  const key = cellHex.toLowerCase()
  const cached = gradientCache.get(key)
  if (cached) {
    // Touch for LRU semantics.
    gradientCache.delete(key)
    gradientCache.set(key, cached)
    return cached
  }
  const grad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: cellHex },
      { offset: 1, color: gradientEndOf(cellHex) },
    ],
  })
  gradientCache.set(key, grad)
  // Evict oldest if over limit.
  if (gradientCache.size > GRADIENT_CACHE_LIMIT) {
    const oldest = gradientCache.keys().next().value
    if (oldest !== undefined) {
      const ev = gradientCache.get(oldest)
      gradientCache.delete(oldest)
      ev?.destroy()
    }
  }
  return grad
}

/** Test-only: drop the cache (forces re-creation on next call). */
export function _resetGradientCacheForTests(): void {
  for (const g of gradientCache.values()) g.destroy()
  gradientCache.clear()
}
