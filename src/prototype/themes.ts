/** Theme system — modes, palettes, and DOM application */

export type ThemeMode = 'light' | 'dark' | 'grey'

export interface ThemePalette {
  // Backgrounds
  bg: string
  viewportBg: string
  childBg: string
  surface: string
  surfaceRaised: string
  surfaceHover: string
  surfaceActive: string
  surfaceActiveHover: string
  glass: string
  glassStrong: string

  // Text
  text: string
  textHeading: string
  textSecondary: string
  textMuted: string
  textOnPrimary: string

  // Core colors
  primary: string
  primaryLight: string
  primaryDark: string
  accent: string
  accentBg: string
  accentBorder: string
  accentStrong: string

  // Borders
  border: string
  borderLight: string

  // Hover tints
  hoverTint: string
  activeTint: string

  // Grid
  gridDot: string

  // Nodes
  nodeCell: string
  nodeGradientEnd: string
  nodeMembrane: string
  nodeLabel: string
  nodeFocusRing: string
  nodeShadow: string

  // Connections
  connection: string
  connectionEvidence: string
  connectionHover: string
  connectionDraft: string

  // Flow
  flow: string
  flowAnim: string
  flowHover: string
  flowGlow: string

  // Status
  success: string
  danger: string
  dangerLight: string
  dangerBg: string
  dangerBorder: string

  // Shadows
  shadow: string
  shadowHeavy: string
}

export const LIGHT_PALETTE: ThemePalette = {
  bg: '#f8fbff',
  viewportBg: 'radial-gradient(circle at 30% 20%, #f5f9ff, #dfebf8)',
  childBg: 'radial-gradient(circle at 40% 30%, #f5f9ff, #dfebf8)',
  surface: '#fff',
  surfaceRaised: '#eef4fb',
  surfaceHover: '#edf6ff',
  surfaceActive: '#d4e8fc',
  surfaceActiveHover: '#c4dcf4',
  glass: 'rgba(255, 255, 255, 0.92)',
  glassStrong: 'rgba(255, 255, 255, 0.94)',

  text: '#17314f',
  textHeading: '#21486f',
  textSecondary: '#4a6e90',
  textMuted: '#8596a8',
  textOnPrimary: '#fff',

  primary: '#365f8f',
  primaryLight: '#6daad8',
  primaryDark: '#2a4d75',
  accent: '#2563eb',
  accentBg: 'rgba(37, 99, 235, 0.08)',
  accentBorder: 'rgba(37, 99, 235, 0.2)',
  accentStrong: 'rgba(37, 99, 235, 0.7)',

  border: '#c8d8ea',
  borderLight: '#e8eff6',

  hoverTint: 'rgba(44, 120, 188, 0.08)',
  activeTint: 'rgba(44, 120, 188, 0.14)',

  gridDot: 'rgba(37, 96, 149, 0.18)',

  nodeCell: '#f4f8fd',
  nodeGradientEnd: '#dfe9f5',
  nodeMembrane: '#365f8f',
  nodeLabel: '#17314f',
  nodeFocusRing: 'rgba(44, 120, 188, 0.2)',
  nodeShadow: 'rgba(19, 41, 73, 0.22)',

  connection: 'rgba(37, 96, 149, 0.45)',
  connectionEvidence: 'rgba(37, 96, 149, 0.65)',
  connectionHover: 'rgba(14, 79, 143, 0.9)',
  connectionDraft: 'rgba(14, 79, 143, 0.5)',

  flow: '#f59e0b',
  flowAnim: '#fbbf24',
  flowHover: '#d97706',
  flowGlow: 'rgba(245, 158, 11, 0.5)',

  success: '#16a34a',
  danger: '#dc2626',
  dangerLight: '#ef4444',
  dangerBg: 'rgba(239, 68, 68, 0.08)',
  dangerBorder: 'rgba(239, 68, 68, 0.2)',

  shadow: 'rgba(19, 41, 73, 0.10)',
  shadowHeavy: 'rgba(19, 41, 73, 0.25)',
}

export const DARK_PALETTE: ThemePalette = {
  bg: '#0c1220',
  viewportBg: 'radial-gradient(circle at 30% 20%, #111a2e, #0a1019)',
  childBg: 'radial-gradient(circle at 40% 30%, #131c30, #0c1322)',
  surface: '#1a2536',
  surfaceRaised: '#1e293b',
  surfaceHover: '#243347',
  surfaceActive: '#2d4059',
  surfaceActiveHover: '#35496a',
  glass: 'rgba(18, 28, 44, 0.92)',
  glassStrong: 'rgba(18, 28, 44, 0.95)',

  text: '#e2e8f0',
  textHeading: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textOnPrimary: '#fff',

  primary: '#5b8ec7',
  primaryLight: '#7ab0e0',
  primaryDark: '#3d6a96',
  accent: '#60a5fa',
  accentBg: 'rgba(96, 165, 250, 0.1)',
  accentBorder: 'rgba(96, 165, 250, 0.25)',
  accentStrong: 'rgba(96, 165, 250, 0.7)',

  border: '#2d3f55',
  borderLight: '#1e2d40',

  hoverTint: 'rgba(96, 165, 250, 0.08)',
  activeTint: 'rgba(96, 165, 250, 0.14)',

  gridDot: 'rgba(96, 165, 250, 0.12)',

  nodeCell: '#1a2636',
  nodeGradientEnd: '#152030',
  nodeMembrane: '#5b8ec7',
  nodeLabel: '#e2e8f0',
  nodeFocusRing: 'rgba(96, 165, 250, 0.25)',
  nodeShadow: 'rgba(0, 0, 0, 0.4)',

  connection: 'rgba(91, 142, 199, 0.45)',
  connectionEvidence: 'rgba(91, 142, 199, 0.65)',
  connectionHover: 'rgba(122, 176, 224, 0.9)',
  connectionDraft: 'rgba(96, 165, 250, 0.5)',

  flow: '#f59e0b',
  flowAnim: '#fbbf24',
  flowHover: '#d97706',
  flowGlow: 'rgba(245, 158, 11, 0.5)',

  success: '#22c55e',
  danger: '#ef4444',
  dangerLight: '#f87171',
  dangerBg: 'rgba(239, 68, 68, 0.12)',
  dangerBorder: 'rgba(239, 68, 68, 0.25)',

  shadow: 'rgba(0, 0, 0, 0.25)',
  shadowHeavy: 'rgba(0, 0, 0, 0.5)',
}

export const GREY_PALETTE: ThemePalette = {
  bg: '#e8eaed',
  viewportBg: 'radial-gradient(circle at 30% 20%, #edeef1, #d5d8de)',
  childBg: 'radial-gradient(circle at 40% 30%, #edeef1, #d8dbe0)',
  surface: '#f6f7f8',
  surfaceRaised: '#edeef0',
  surfaceHover: '#e3e5e8',
  surfaceActive: '#cdd1d8',
  surfaceActiveHover: '#c0c5cd',
  glass: 'rgba(240, 241, 243, 0.92)',
  glassStrong: 'rgba(240, 241, 243, 0.95)',

  text: '#1f2937',
  textHeading: '#111827',
  textSecondary: '#4b5563',
  textMuted: '#9ca3af',
  textOnPrimary: '#fff',

  primary: '#4b6a8a',
  primaryLight: '#7a9ab8',
  primaryDark: '#374f66',
  accent: '#3b82f6',
  accentBg: 'rgba(59, 130, 246, 0.08)',
  accentBorder: 'rgba(59, 130, 246, 0.2)',
  accentStrong: 'rgba(59, 130, 246, 0.7)',

  border: '#ced2d9',
  borderLight: '#dfe2e6',

  hoverTint: 'rgba(75, 106, 138, 0.08)',
  activeTint: 'rgba(75, 106, 138, 0.14)',

  gridDot: 'rgba(75, 106, 138, 0.15)',

  nodeCell: '#f0f1f3',
  nodeGradientEnd: '#dfe1e5',
  nodeMembrane: '#4b6a8a',
  nodeLabel: '#1f2937',
  nodeFocusRing: 'rgba(75, 106, 138, 0.2)',
  nodeShadow: 'rgba(31, 41, 55, 0.18)',

  connection: 'rgba(75, 106, 138, 0.45)',
  connectionEvidence: 'rgba(75, 106, 138, 0.65)',
  connectionHover: 'rgba(55, 79, 102, 0.9)',
  connectionDraft: 'rgba(59, 130, 246, 0.5)',

  flow: '#f59e0b',
  flowAnim: '#fbbf24',
  flowHover: '#d97706',
  flowGlow: 'rgba(245, 158, 11, 0.5)',

  success: '#16a34a',
  danger: '#dc2626',
  dangerLight: '#ef4444',
  dangerBg: 'rgba(239, 68, 68, 0.08)',
  dangerBorder: 'rgba(239, 68, 68, 0.2)',

  shadow: 'rgba(31, 41, 55, 0.10)',
  shadowHeavy: 'rgba(31, 41, 55, 0.22)',
}

export const MODE_PALETTES: Record<ThemeMode, ThemePalette> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
  grey: GREY_PALETTE,
}

/** CSS variable name for each palette key */
const VAR_PREFIX = '--ug-'
const KEY_TO_VAR: Record<keyof ThemePalette, string> = Object.fromEntries(
  Object.keys(LIGHT_PALETTE).map((k) => [
    k,
    VAR_PREFIX + k.replace(/([A-Z])/g, '-$1').toLowerCase(),
  ]),
) as Record<keyof ThemePalette, string>

/** Get the CSS variable name for a palette key */
export function cssVar(key: keyof ThemePalette): string {
  return `var(${KEY_TO_VAR[key]})`
}

/** Apply a palette to document.documentElement as CSS custom properties */
export function applyThemeToDOM(palette: ThemePalette): void {
  const style = document.documentElement.style
  for (const key of Object.keys(palette) as (keyof ThemePalette)[]) {
    style.setProperty(KEY_TO_VAR[key], palette[key])
  }
}

/** Resolve the effective palette for a given mode */
export function resolvePalette(mode: ThemeMode): ThemePalette {
  return MODE_PALETTES[mode]
}
