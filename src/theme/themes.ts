/** Theme system — modes, palettes, and DOM application */

import type { BackgroundConfig, GridConfig, ThemeMode } from './types'

export type { ThemeMode }

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

export const LIGHT_DARK_PALETTE: ThemePalette = {
  bg: '#dce6f1',
  viewportBg: 'radial-gradient(circle at 30% 20%, #e8f0f8, #b9cada)',
  childBg: 'radial-gradient(circle at 40% 30%, #e8f0f8, #c1d0df)',
  surface: '#eef4fa',
  surfaceRaised: '#dbe6f1',
  surfaceHover: '#d1deeb',
  surfaceActive: '#b8cadd',
  surfaceActiveHover: '#a9bdd2',
  glass: 'rgba(235, 242, 249, 0.9)',
  glassStrong: 'rgba(226, 236, 246, 0.94)',

  text: '#18304a',
  textHeading: '#10243a',
  textSecondary: '#42627f',
  textMuted: '#6f8498',
  textOnPrimary: '#f8fbff',

  primary: '#416a94',
  primaryLight: '#6f9bc6',
  primaryDark: '#2f5378',
  accent: '#3f7ec9',
  accentBg: 'rgba(63, 126, 201, 0.10)',
  accentBorder: 'rgba(63, 126, 201, 0.24)',
  accentStrong: 'rgba(63, 126, 201, 0.72)',

  border: '#aebfd1',
  borderLight: '#cbd8e5',

  hoverTint: 'rgba(65, 106, 148, 0.09)',
  activeTint: 'rgba(65, 106, 148, 0.16)',

  gridDot: 'rgba(65, 106, 148, 0.16)',

  nodeCell: '#e6eef6',
  nodeGradientEnd: '#ccd9e7',
  nodeMembrane: '#416a94',
  nodeLabel: '#18304a',
  nodeFocusRing: 'rgba(65, 106, 148, 0.23)',
  nodeShadow: 'rgba(16, 36, 58, 0.24)',

  connection: 'rgba(65, 106, 148, 0.48)',
  connectionEvidence: 'rgba(65, 106, 148, 0.68)',
  connectionHover: 'rgba(47, 83, 120, 0.92)',
  connectionDraft: 'rgba(63, 126, 201, 0.54)',

  flow: '#e09112',
  flowAnim: '#f2b329',
  flowHover: '#bd7410',
  flowGlow: 'rgba(224, 145, 18, 0.46)',

  success: '#15803d',
  danger: '#c2413c',
  dangerLight: '#dc5b55',
  dangerBg: 'rgba(194, 65, 60, 0.10)',
  dangerBorder: 'rgba(194, 65, 60, 0.24)',

  shadow: 'rgba(16, 36, 58, 0.14)',
  shadowHeavy: 'rgba(16, 36, 58, 0.30)',
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

export const MODE_PALETTES: Record<string, ThemePalette> = {
  light: LIGHT_PALETTE,
  'light-dark': LIGHT_DARK_PALETTE,
  dark: DARK_PALETTE,
  grey: GREY_PALETTE,
}

// ---- Woody (topical) palette ----

export const WOODY_PALETTE: ThemePalette = {
  bg: '#f5efe6',
  viewportBg: 'radial-gradient(circle at 35% 25%, #f5efe6, #e6dac8)',
  childBg: 'radial-gradient(circle at 40% 30%, #f5efe6, #e0d4be)',
  surface: '#faf6f0',
  surfaceRaised: '#ede4d4',
  surfaceHover: '#e8ddc8',
  surfaceActive: '#d9cbb2',
  surfaceActiveHover: '#cfc0a4',
  glass: 'rgba(245, 239, 230, 0.92)',
  glassStrong: 'rgba(245, 239, 230, 0.95)',

  text: '#3e2c1a',
  textHeading: '#2e1e0e',
  textSecondary: '#6b5340',
  textMuted: '#9a8672',
  textOnPrimary: '#faf6f0',

  primary: '#6b4226',
  primaryLight: '#8b6a4a',
  primaryDark: '#4a2e19',
  accent: '#8b6914',
  accentBg: 'rgba(139, 105, 20, 0.08)',
  accentBorder: 'rgba(139, 105, 20, 0.2)',
  accentStrong: 'rgba(139, 105, 20, 0.7)',

  border: '#c4ae8e',
  borderLight: '#ddd2be',

  hoverTint: 'rgba(107, 66, 38, 0.08)',
  activeTint: 'rgba(107, 66, 38, 0.14)',

  gridDot: 'rgba(107, 66, 38, 0.15)',

  nodeCell: '#f0e8da',
  nodeGradientEnd: '#dfd3be',
  nodeMembrane: '#6b4226',
  nodeLabel: '#3e2c1a',
  nodeFocusRing: 'rgba(107, 66, 38, 0.2)',
  nodeShadow: 'rgba(62, 44, 26, 0.22)',

  connection: 'rgba(107, 66, 38, 0.45)',
  connectionEvidence: 'rgba(107, 66, 38, 0.65)',
  connectionHover: 'rgba(74, 46, 25, 0.9)',
  connectionDraft: 'rgba(139, 105, 20, 0.5)',

  flow: '#d4a017',
  flowAnim: '#e6b422',
  flowHover: '#b8860b',
  flowGlow: 'rgba(212, 160, 23, 0.5)',

  success: '#228B22',
  danger: '#b22222',
  dangerLight: '#cd5c5c',
  dangerBg: 'rgba(178, 34, 34, 0.08)',
  dangerBorder: 'rgba(178, 34, 34, 0.2)',

  shadow: 'rgba(62, 44, 26, 0.12)',
  shadowHeavy: 'rgba(62, 44, 26, 0.28)',
}

// ---- Frutiger Aero (topical) palette ----

export const FRUTIGER_AERO_PALETTE: ThemePalette = {
  bg: '#e8f4f8',
  viewportBg: 'radial-gradient(circle at 30% 20%, #e8f8ff, #d0edf8)',
  childBg: 'radial-gradient(circle at 40% 30%, #e8f8ff, #cce8f4)',
  surface: '#f0faff',
  surfaceRaised: '#ddf0f8',
  surfaceHover: '#d0ecf6',
  surfaceActive: '#b8ddef',
  surfaceActiveHover: '#a8d3e8',
  glass: 'rgba(230, 248, 255, 0.88)',
  glassStrong: 'rgba(230, 248, 255, 0.92)',

  text: '#1a3a4a',
  textHeading: '#0d2e3e',
  textSecondary: '#4a7080',
  textMuted: '#7fa0b0',
  textOnPrimary: '#fff',

  primary: '#2196f3',
  primaryLight: '#64b5f6',
  primaryDark: '#1565c0',
  accent: '#00bcd4',
  accentBg: 'rgba(0, 188, 212, 0.08)',
  accentBorder: 'rgba(0, 188, 212, 0.2)',
  accentStrong: 'rgba(0, 188, 212, 0.7)',

  border: '#b0d8e8',
  borderLight: '#d4eaf2',

  hoverTint: 'rgba(33, 150, 243, 0.08)',
  activeTint: 'rgba(33, 150, 243, 0.14)',

  gridDot: 'rgba(33, 150, 243, 0.12)',

  nodeCell: '#eaf6fc',
  nodeGradientEnd: '#d4ecf6',
  nodeMembrane: '#2196f3',
  nodeLabel: '#1a3a4a',
  nodeFocusRing: 'rgba(33, 150, 243, 0.2)',
  nodeShadow: 'rgba(26, 58, 74, 0.18)',

  connection: 'rgba(33, 150, 243, 0.4)',
  connectionEvidence: 'rgba(33, 150, 243, 0.6)',
  connectionHover: 'rgba(21, 101, 192, 0.9)',
  connectionDraft: 'rgba(0, 188, 212, 0.5)',

  flow: '#4caf50',
  flowAnim: '#66bb6a',
  flowHover: '#388e3c',
  flowGlow: 'rgba(76, 175, 80, 0.5)',

  success: '#4caf50',
  danger: '#e53935',
  dangerLight: '#ef5350',
  dangerBg: 'rgba(229, 57, 53, 0.08)',
  dangerBorder: 'rgba(229, 57, 53, 0.2)',

  shadow: 'rgba(26, 58, 74, 0.10)',
  shadowHeavy: 'rgba(26, 58, 74, 0.22)',
}

// ---- Steel (topical) palette ----

export const STEEL_PALETTE: ThemePalette = {
  bg: '#1c1f26',
  viewportBg: 'radial-gradient(circle at 30% 20%, #24282f, #181b22)',
  childBg: 'radial-gradient(circle at 40% 30%, #282c34, #1c1f26)',
  surface: '#2a2e36',
  surfaceRaised: '#323840',
  surfaceHover: '#3a4048',
  surfaceActive: '#454c56',
  surfaceActiveHover: '#505860',
  glass: 'rgba(28, 31, 38, 0.92)',
  glassStrong: 'rgba(28, 31, 38, 0.95)',

  text: '#c8cdd4',
  textHeading: '#e0e4ea',
  textSecondary: '#8a929e',
  textMuted: '#5c6370',
  textOnPrimary: '#fff',

  primary: '#8a929e',
  primaryLight: '#a8b0bc',
  primaryDark: '#6b7280',
  accent: '#f59e0b',
  accentBg: 'rgba(245, 158, 11, 0.1)',
  accentBorder: 'rgba(245, 158, 11, 0.25)',
  accentStrong: 'rgba(245, 158, 11, 0.7)',

  border: '#3a4048',
  borderLight: '#2e343c',

  hoverTint: 'rgba(245, 158, 11, 0.06)',
  activeTint: 'rgba(245, 158, 11, 0.12)',

  gridDot: 'rgba(138, 146, 158, 0.12)',

  nodeCell: '#282c34',
  nodeGradientEnd: '#22262e',
  nodeMembrane: '#6b7280',
  nodeLabel: '#c8cdd4',
  nodeFocusRing: 'rgba(245, 158, 11, 0.2)',
  nodeShadow: 'rgba(0, 0, 0, 0.35)',

  connection: 'rgba(138, 146, 158, 0.4)',
  connectionEvidence: 'rgba(138, 146, 158, 0.6)',
  connectionHover: 'rgba(168, 176, 188, 0.9)',
  connectionDraft: 'rgba(245, 158, 11, 0.5)',

  flow: '#f59e0b',
  flowAnim: '#fbbf24',
  flowHover: '#d97706',
  flowGlow: 'rgba(245, 158, 11, 0.5)',

  success: '#22c55e',
  danger: '#ef4444',
  dangerLight: '#f87171',
  dangerBg: 'rgba(239, 68, 68, 0.12)',
  dangerBorder: 'rgba(239, 68, 68, 0.25)',

  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowHeavy: 'rgba(0, 0, 0, 0.5)',
}

// ---- Sci-Fi (topical) palette ----

export const SCI_FI_PALETTE: ThemePalette = {
  bg: '#0a0e1a',
  viewportBg: 'radial-gradient(circle at 50% 30%, #0f1628, #060a14)',
  childBg: 'radial-gradient(circle at 40% 30%, #121a2e, #0a0e1a)',
  surface: '#141c2e',
  surfaceRaised: '#1a2440',
  surfaceHover: '#1e2a48',
  surfaceActive: '#243254',
  surfaceActiveHover: '#2a3a60',
  glass: 'rgba(10, 14, 26, 0.92)',
  glassStrong: 'rgba(10, 14, 26, 0.95)',

  text: '#c0e8ff',
  textHeading: '#e0f4ff',
  textSecondary: '#6db8e0',
  textMuted: '#3a7aa0',
  textOnPrimary: '#0a0e1a',

  primary: '#06b6d4',
  primaryLight: '#22d3ee',
  primaryDark: '#0891b2',
  accent: '#a78bfa',
  accentBg: 'rgba(167, 139, 250, 0.1)',
  accentBorder: 'rgba(167, 139, 250, 0.25)',
  accentStrong: 'rgba(167, 139, 250, 0.7)',

  border: '#1e3050',
  borderLight: '#162440',

  hoverTint: 'rgba(6, 182, 212, 0.08)',
  activeTint: 'rgba(6, 182, 212, 0.14)',

  gridDot: 'rgba(6, 182, 212, 0.15)',

  nodeCell: '#121c30',
  nodeGradientEnd: '#0e1624',
  nodeMembrane: '#06b6d4',
  nodeLabel: '#c0e8ff',
  nodeFocusRing: 'rgba(6, 182, 212, 0.25)',
  nodeShadow: 'rgba(0, 0, 0, 0.45)',

  connection: 'rgba(6, 182, 212, 0.4)',
  connectionEvidence: 'rgba(6, 182, 212, 0.6)',
  connectionHover: 'rgba(34, 211, 238, 0.9)',
  connectionDraft: 'rgba(167, 139, 250, 0.5)',

  flow: '#a78bfa',
  flowAnim: '#c4b5fd',
  flowHover: '#8b5cf6',
  flowGlow: 'rgba(167, 139, 250, 0.5)',

  success: '#22d3ee',
  danger: '#f43f5e',
  dangerLight: '#fb7185',
  dangerBg: 'rgba(244, 63, 94, 0.12)',
  dangerBorder: 'rgba(244, 63, 94, 0.25)',

  shadow: 'rgba(0, 0, 0, 0.35)',
  shadowHeavy: 'rgba(0, 0, 0, 0.55)',
}

// ---- Aqua (topical) palette ----

export const AQUA_PALETTE: ThemePalette = {
  bg: '#0c2030',
  viewportBg: 'radial-gradient(circle at 50% 60%, #0e2a40, #081828)',
  childBg: 'radial-gradient(circle at 40% 50%, #102c44, #0a1e30)',
  surface: '#133048',
  surfaceRaised: '#183a54',
  surfaceHover: '#1e4462',
  surfaceActive: '#245070',
  surfaceActiveHover: '#2a5a7e',
  glass: 'rgba(12, 32, 48, 0.92)',
  glassStrong: 'rgba(12, 32, 48, 0.95)',

  text: '#b8e8f0',
  textHeading: '#d4f4f8',
  textSecondary: '#68b8d0',
  textMuted: '#3a7890',
  textOnPrimary: '#081828',

  primary: '#0ea5e9',
  primaryLight: '#38bdf8',
  primaryDark: '#0284c7',
  accent: '#2dd4bf',
  accentBg: 'rgba(45, 212, 191, 0.1)',
  accentBorder: 'rgba(45, 212, 191, 0.25)',
  accentStrong: 'rgba(45, 212, 191, 0.7)',

  border: '#1a4060',
  borderLight: '#143050',

  hoverTint: 'rgba(14, 165, 233, 0.08)',
  activeTint: 'rgba(14, 165, 233, 0.14)',

  gridDot: 'rgba(14, 165, 233, 0.12)',

  nodeCell: '#14344c',
  nodeGradientEnd: '#102840',
  nodeMembrane: '#0ea5e9',
  nodeLabel: '#b8e8f0',
  nodeFocusRing: 'rgba(14, 165, 233, 0.25)',
  nodeShadow: 'rgba(0, 0, 0, 0.4)',

  connection: 'rgba(14, 165, 233, 0.4)',
  connectionEvidence: 'rgba(14, 165, 233, 0.6)',
  connectionHover: 'rgba(56, 189, 248, 0.9)',
  connectionDraft: 'rgba(45, 212, 191, 0.5)',

  flow: '#2dd4bf',
  flowAnim: '#5eead4',
  flowHover: '#14b8a6',
  flowGlow: 'rgba(45, 212, 191, 0.5)',

  success: '#2dd4bf',
  danger: '#f43f5e',
  dangerLight: '#fb7185',
  dangerBg: 'rgba(244, 63, 94, 0.12)',
  dangerBorder: 'rgba(244, 63, 94, 0.25)',

  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowHeavy: 'rgba(0, 0, 0, 0.5)',
}

// ---- Biology (topical) palette ----

export const BIOLOGY_PALETTE: ThemePalette = {
  bg: '#f0f8f0',
  viewportBg: 'radial-gradient(circle at 35% 25%, #f2faf0, #dcefd8)',
  childBg: 'radial-gradient(circle at 40% 30%, #f0f9ee, #d8ecd4)',
  surface: '#f6fbf4',
  surfaceRaised: '#e4f2e0',
  surfaceHover: '#d8ecd4',
  surfaceActive: '#c4dfc0',
  surfaceActiveHover: '#b4d4b0',
  glass: 'rgba(240, 248, 240, 0.92)',
  glassStrong: 'rgba(240, 248, 240, 0.95)',

  text: '#1a3320',
  textHeading: '#0e2414',
  textSecondary: '#3d6b48',
  textMuted: '#6a9a74',
  textOnPrimary: '#f6fbf4',

  primary: '#2e7d32',
  primaryLight: '#4caf50',
  primaryDark: '#1b5e20',
  accent: '#7cb342',
  accentBg: 'rgba(124, 179, 66, 0.08)',
  accentBorder: 'rgba(124, 179, 66, 0.2)',
  accentStrong: 'rgba(124, 179, 66, 0.7)',

  border: '#a8d4a0',
  borderLight: '#c8e4c4',

  hoverTint: 'rgba(46, 125, 50, 0.08)',
  activeTint: 'rgba(46, 125, 50, 0.14)',

  gridDot: 'rgba(46, 125, 50, 0.12)',

  nodeCell: '#ecf5ea',
  nodeGradientEnd: '#d8ecd4',
  nodeMembrane: '#2e7d32',
  nodeLabel: '#1a3320',
  nodeFocusRing: 'rgba(46, 125, 50, 0.2)',
  nodeShadow: 'rgba(26, 51, 32, 0.18)',

  connection: 'rgba(46, 125, 50, 0.4)',
  connectionEvidence: 'rgba(46, 125, 50, 0.6)',
  connectionHover: 'rgba(27, 94, 32, 0.9)',
  connectionDraft: 'rgba(124, 179, 66, 0.5)',

  flow: '#ff9800',
  flowAnim: '#ffb74d',
  flowHover: '#f57c00',
  flowGlow: 'rgba(255, 152, 0, 0.5)',

  success: '#4caf50',
  danger: '#d32f2f',
  dangerLight: '#e57373',
  dangerBg: 'rgba(211, 47, 47, 0.08)',
  dangerBorder: 'rgba(211, 47, 47, 0.2)',

  shadow: 'rgba(26, 51, 32, 0.10)',
  shadowHeavy: 'rgba(26, 51, 32, 0.24)',
}

// ---- Medical (topical) palette ----

export const MEDICAL_PALETTE: ThemePalette = {
  bg: '#f8fbff',
  viewportBg: 'radial-gradient(circle at 30% 20%, #f5faff, #eaf2fb)',
  childBg: 'radial-gradient(circle at 40% 30%, #f5faff, #e8f0f8)',
  surface: '#ffffff',
  surfaceRaised: '#f0f5fa',
  surfaceHover: '#e8f0f8',
  surfaceActive: '#d4e4f0',
  surfaceActiveHover: '#c4d8ea',
  glass: 'rgba(248, 251, 255, 0.94)',
  glassStrong: 'rgba(248, 251, 255, 0.96)',

  text: '#1e3a5f',
  textHeading: '#0d2744',
  textSecondary: '#5580a0',
  textMuted: '#8aa8c0',
  textOnPrimary: '#fff',

  primary: '#1976d2',
  primaryLight: '#42a5f5',
  primaryDark: '#0d47a1',
  accent: '#e53935',
  accentBg: 'rgba(229, 57, 53, 0.06)',
  accentBorder: 'rgba(229, 57, 53, 0.18)',
  accentStrong: 'rgba(229, 57, 53, 0.7)',

  border: '#d0dde8',
  borderLight: '#e4ecf2',

  hoverTint: 'rgba(25, 118, 210, 0.06)',
  activeTint: 'rgba(25, 118, 210, 0.12)',

  gridDot: 'rgba(25, 118, 210, 0.1)',

  nodeCell: '#f2f7fc',
  nodeGradientEnd: '#e4edf6',
  nodeMembrane: '#1976d2',
  nodeLabel: '#1e3a5f',
  nodeFocusRing: 'rgba(25, 118, 210, 0.2)',
  nodeShadow: 'rgba(30, 58, 95, 0.14)',

  connection: 'rgba(25, 118, 210, 0.35)',
  connectionEvidence: 'rgba(25, 118, 210, 0.55)',
  connectionHover: 'rgba(13, 71, 161, 0.9)',
  connectionDraft: 'rgba(229, 57, 53, 0.5)',

  flow: '#e53935',
  flowAnim: '#ef5350',
  flowHover: '#c62828',
  flowGlow: 'rgba(229, 57, 53, 0.5)',

  success: '#2e7d32',
  danger: '#e53935',
  dangerLight: '#ef5350',
  dangerBg: 'rgba(229, 57, 53, 0.06)',
  dangerBorder: 'rgba(229, 57, 53, 0.18)',

  shadow: 'rgba(30, 58, 95, 0.08)',
  shadowHeavy: 'rgba(30, 58, 95, 0.18)',
}

// ---- Topical theme presets ----

export interface TopicalThemePreset {
  id: ThemeMode
  name: string
  palette: ThemePalette
  background: BackgroundConfig
  particlePreset: string
  grid: GridConfig
  cssClass: string
}

export const TOPICAL_THEMES: TopicalThemePreset[] = [
  {
    id: 'woody',
    name: 'Woody',
    palette: WOODY_PALETTE,
    background: { type: 'gradient', value: 'linear-gradient(160deg, #f5efe6, #e6dac8, #d4c4a6)' },
    particlePreset: 'falling-leaves',
    grid: { color: 'rgba(107, 66, 38, 0.12)', size: 24, style: 'dots' },
    cssClass: 'theme-woody',
  },
  {
    id: 'frutiger-aero',
    name: 'Frutiger Aero',
    palette: FRUTIGER_AERO_PALETTE,
    background: { type: 'gradient', value: 'linear-gradient(135deg, #e0f7fa, #b2ebf2, #e0f2f1, #b2dfdb)' },
    particlePreset: 'glossy-bubbles',
    grid: { color: 'rgba(33, 150, 243, 0.08)', size: 24, style: 'dots' },
    cssClass: 'theme-frutiger-aero',
  },
  {
    id: 'steel',
    name: 'Steel',
    palette: STEEL_PALETTE,
    background: { type: 'gradient', value: 'linear-gradient(170deg, #1c1f26, #2a2e36, #1c1f26)' },
    particlePreset: 'sparks',
    grid: { color: 'rgba(138, 146, 158, 0.08)', size: 20, style: 'lines' },
    cssClass: 'theme-steel',
  },
  {
    id: 'sci-fi',
    name: 'Sci-Fi',
    palette: SCI_FI_PALETTE,
    background: { type: 'gradient', value: 'radial-gradient(ellipse at 50% 30%, #0f1628, #060a14)' },
    particlePreset: 'data-hex',
    grid: { color: 'rgba(6, 182, 212, 0.08)', size: 28, style: 'lines' },
    cssClass: 'theme-sci-fi',
  },
  {
    id: 'aqua',
    name: 'Aqua',
    palette: AQUA_PALETTE,
    background: { type: 'gradient', value: 'radial-gradient(ellipse at 50% 80%, #0e2a40, #081828, #04101c)' },
    particlePreset: 'ocean-bubbles',
    grid: { color: 'rgba(14, 165, 233, 0.06)', size: 24, style: 'dotted-lines' },
    cssClass: 'theme-aqua',
  },
  {
    id: 'biology',
    name: 'Biology',
    palette: BIOLOGY_PALETTE,
    background: { type: 'gradient', value: 'radial-gradient(circle at 40% 30%, #f2faf0, #dcefd8, #c8e4c0)' },
    particlePreset: 'spores',
    grid: { color: 'rgba(46, 125, 50, 0.08)', size: 24, style: 'dots' },
    cssClass: 'theme-biology',
  },
  {
    id: 'medical',
    name: 'Medical',
    palette: MEDICAL_PALETTE,
    background: { type: 'gradient', value: 'linear-gradient(180deg, #f5faff, #eaf2fb, #f5faff)' },
    particlePreset: 'sterile-motes',
    grid: { color: 'rgba(25, 118, 210, 0.06)', size: 20, style: 'lines' },
    cssClass: 'theme-medical',
  },
]

/** Get a topical theme preset by mode id, or undefined for base themes */
export function getTopicalPreset(mode: ThemeMode): TopicalThemePreset | undefined {
  return TOPICAL_THEMES.find((t) => t.id === mode)
}

/** All theme options for the selector UI */
export const ALL_THEME_OPTIONS: { id: ThemeMode; name: string; group: 'base' | 'topical' }[] = [
  { id: 'light', name: 'Light', group: 'base' },
  { id: 'light-dark', name: 'Light-Dark', group: 'base' },
  { id: 'dark', name: 'Dark', group: 'base' },
  { id: 'grey', name: 'Grey', group: 'base' },
  ...TOPICAL_THEMES.map((t) => ({ id: t.id, name: t.name, group: 'topical' as const })),
]

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
  const topical = getTopicalPreset(mode)
  if (topical) return topical.palette
  return MODE_PALETTES[mode] ?? LIGHT_PALETTE
}
