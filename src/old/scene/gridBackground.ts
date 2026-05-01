import type { GridConfig } from '../model/sampleModels'

/** Build CSS background-image for the grid based on config */
export function gridBackgroundImage(cfg?: GridConfig): string {
  const color = cfg?.color || 'var(--ug-grid-dot)'
  const size = cfg?.size ?? 1
  const style = cfg?.style ?? 'dots'
  if (style === 'lines') {
    return `linear-gradient(${color} ${size}px, transparent ${size}px), linear-gradient(90deg, ${color} ${size}px, transparent ${size}px)`
  }
  if (style === 'dotted-lines') {
    return `repeating-linear-gradient(0deg, ${color} 0 ${size}px, transparent ${size}px ${size * 4}px), repeating-linear-gradient(90deg, ${color} 0 ${size}px, transparent ${size}px ${size * 4}px)`
  }
  // dots (default)
  return `radial-gradient(circle, ${color} ${size}px, transparent ${size}px)`
}
