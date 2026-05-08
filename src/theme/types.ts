/**
 * Cosmetic theme types — palette mode, background, particle preset, grid hints.
 *
 * These are diagram-level settings that affect rendering only (not logical
 * structure). They round-trip via `Model.cosmetics`.
 */

export type ThemeMode =
  | 'light'
  | 'light-dark'
  | 'dark'
  | 'grey'
  | 'woody'
  | 'frutiger-aero'
  | 'steel'
  | 'sci-fi'
  | 'aqua'
  | 'biology'
  | 'medical'

export type BackgroundType = 'gradient' | 'solid' | 'image' | 'pattern'

export interface BackgroundConfig {
  type: BackgroundType
  /** CSS gradient string, hex color, data URL, or pattern id. */
  value: string
  opacity?: number
  blur?: number
  fit?: 'cover' | 'contain' | 'tile'
}

export type GridStyle = 'dots' | 'lines' | 'dotted-lines'

export interface GridConfig {
  color?: string
  size?: number
  style?: GridStyle
}

export interface ModelCosmetics {
  themeMode?: ThemeMode
  background?: BackgroundConfig
  particleEffect?: string | null
  grid?: GridConfig
}
