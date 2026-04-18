/**
 * Reads CSS custom properties (--ug-*) and converts them to PixiJS-compatible
 * numeric or string colors. Re-reads on demand when the theme changes.
 */

export interface PixiThemeColors {
  connection: number
  connectionAlpha: number
  connectionEvidence: number
  connectionEvidenceAlpha: number
  connectionHover: number
  connectionHoverAlpha: number
  connectionDraft: number
  connectionDraftAlpha: number
  flow: number
  flowAnim: number
  flowGlow: number
  flowGlowAlpha: number
  text: number
  textSecondary: number
  border: number
}

let cache: PixiThemeColors | null = null

/** Parse CSS color strings into { color: 0xRRGGBB, alpha: 0-1 } */
function parseColor(raw: string): { color: number; alpha: number } {
  raw = raw.trim()

  // rgba(r, g, b, a)
  const rgbaMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1])
    const g = parseInt(rgbaMatch[2])
    const b = parseInt(rgbaMatch[3])
    const a = rgbaMatch[4] != null ? parseFloat(rgbaMatch[4]) : 1
    return { color: (r << 16) | (g << 8) | b, alpha: a }
  }

  // #rrggbb or #rgb
  if (raw.startsWith('#')) {
    let hex = raw.slice(1)
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    return { color: parseInt(hex, 16), alpha: 1 }
  }

  // Fallback
  return { color: 0x888888, alpha: 1 }
}

function readTheme(): PixiThemeColors {
  const s = getComputedStyle(document.documentElement)
  const read = (name: string) => s.getPropertyValue(name).trim()

  const conn = parseColor(read('--ug-connection') || 'rgba(37, 96, 149, 0.45)')
  const connEv = parseColor(read('--ug-connection-evidence') || 'rgba(37, 96, 149, 0.65)')
  const connHov = parseColor(read('--ug-connection-hover') || 'rgba(14, 79, 143, 0.9)')
  const connDraft = parseColor(read('--ug-connection-draft') || 'rgba(14, 79, 143, 0.5)')
  const flow = parseColor(read('--ug-flow') || '#f59e0b')
  const flowAnim = parseColor(read('--ug-flow-anim') || '#fbbf24')
  const flowGlow = parseColor(read('--ug-flow-glow') || 'rgba(245, 158, 11, 0.5)')
  const text = parseColor(read('--ug-text') || '#17314f')
  const textSec = parseColor(read('--ug-text-secondary') || '#4a6e90')
  const border = parseColor(read('--ug-border') || '#c8d8ea')

  return {
    connection: conn.color,
    connectionAlpha: conn.alpha,
    connectionEvidence: connEv.color,
    connectionEvidenceAlpha: connEv.alpha,
    connectionHover: connHov.color,
    connectionHoverAlpha: connHov.alpha,
    connectionDraft: connDraft.color,
    connectionDraftAlpha: connDraft.alpha,
    flow: flow.color,
    flowAnim: flowAnim.color,
    flowGlow: flowGlow.color,
    flowGlowAlpha: flowGlow.alpha,
    text: text.color,
    textSecondary: textSec.color,
    border: border.color,
  }
}

/** Get current theme colors (cached). Call `invalidatePixiTheme()` on theme change. */
export function getPixiTheme(): PixiThemeColors {
  if (!cache) cache = readTheme()
  return cache
}

/** Invalidate cached theme colors — call when the CSS theme changes. */
export function invalidatePixiTheme(): void {
  cache = null
}
