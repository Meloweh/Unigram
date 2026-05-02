/** Background presets and configuration */

import type { CSSProperties } from 'react'
import type { BackgroundConfig, BackgroundType } from './types'
export type { BackgroundConfig, BackgroundType }

export interface BackgroundPreset {
  id: string
  name: string
  type: BackgroundType
  value: string
}

// ---- Gradient presets ----

export const GRADIENT_PRESETS: BackgroundPreset[] = [
  { id: 'g-default',   name: 'Default Blue',   type: 'gradient', value: 'radial-gradient(circle at 30% 20%, #f5f9ff, #dfebf8)' },
  { id: 'g-sunset',    name: 'Sunset',         type: 'gradient', value: 'linear-gradient(135deg, #fef3e2, #fcd9b8, #f9c4b4)' },
  { id: 'g-ocean',     name: 'Deep Ocean',     type: 'gradient', value: 'radial-gradient(ellipse at 50% 0%, #0a2540, #0c1929, #030b14)' },
  { id: 'g-mint',      name: 'Cool Mint',      type: 'gradient', value: 'linear-gradient(160deg, #f0fdf4, #d1fae5, #e0f2fe)' },
  { id: 'g-dawn',      name: 'Dawn',           type: 'gradient', value: 'linear-gradient(to bottom, #fdf4ff, #fce7f3, #ffe4e6)' },
  { id: 'g-dusk',      name: 'Dusk',           type: 'gradient', value: 'linear-gradient(135deg, #1e1b4b, #312e81, #4c1d95)' },
  { id: 'g-neutral',   name: 'Neutral Fade',   type: 'gradient', value: 'radial-gradient(circle at 50% 40%, #f9fafb, #e5e7eb)' },
  { id: 'g-aurora',    name: 'Aurora',         type: 'gradient', value: 'linear-gradient(135deg, #0f172a, #164e63, #1e3a5f, #2d1b69)' },
  { id: 'g-warm',      name: 'Warm Sand',      type: 'gradient', value: 'radial-gradient(circle at 40% 30%, #fefce8, #fef3c7, #fde68a)' },
  { id: 'g-slate',     name: 'Slate',          type: 'gradient', value: 'linear-gradient(170deg, #1e293b, #334155, #475569)' },
]

// ---- Pattern presets (inline SVG data URIs for crisp scaling) ----

function svgDataUri(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const patternDots = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="1" fill="rgba(100,116,139,0.2)"/></svg>`
)
const patternLines = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><line x1="0" y1="20" x2="20" y2="20" stroke="rgba(100,116,139,0.12)" stroke-width="1"/></svg>`
)
const patternCrosshatch = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><line x1="0" y1="0" x2="20" y2="20" stroke="rgba(100,116,139,0.1)" stroke-width="0.5"/><line x1="20" y1="0" x2="0" y2="20" stroke="rgba(100,116,139,0.1)" stroke-width="0.5"/></svg>`
)
const patternDiagonal = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><line x1="0" y1="0" x2="10" y2="10" stroke="rgba(100,116,139,0.12)" stroke-width="0.5"/></svg>`
)
const patternIsometric = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><line x1="0" y1="24" x2="20" y2="0" stroke="rgba(100,116,139,0.1)" stroke-width="0.5"/><line x1="20" y1="0" x2="40" y2="24" stroke="rgba(100,116,139,0.1)" stroke-width="0.5"/></svg>`
)
const patternHexagons = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="49"><path d="M14 0 L28 8.5 L28 25.5 L14 34 L0 25.5 L0 8.5 Z" fill="none" stroke="rgba(100,116,139,0.1)" stroke-width="0.5" transform="translate(0,7.5)"/></svg>`
)

export const PATTERN_PRESETS: BackgroundPreset[] = [
  { id: 'p-dots',       name: 'Dots',            type: 'pattern', value: patternDots },
  { id: 'p-lines',      name: 'Lines',           type: 'pattern', value: patternLines },
  { id: 'p-crosshatch', name: 'Crosshatch',      type: 'pattern', value: patternCrosshatch },
  { id: 'p-diagonal',   name: 'Diagonal',        type: 'pattern', value: patternDiagonal },
  { id: 'p-isometric',  name: 'Isometric',       type: 'pattern', value: patternIsometric },
  { id: 'p-hexagons',   name: 'Hexagons',        type: 'pattern', value: patternHexagons },
]

/** Resolve a BackgroundConfig to CSS properties for the viewport div */
export function resolveBackground(config: BackgroundConfig): CSSProperties {
  switch (config.type) {
    case 'gradient':
      return { background: config.value }
    case 'solid':
      return { background: config.value }
    case 'pattern':
      return { backgroundImage: config.value, backgroundRepeat: 'repeat' }
    case 'image':
      // Image backgrounds are rendered as a separate layer, not inline style
      return {}
    default:
      return {}
  }
}
