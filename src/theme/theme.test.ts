import { describe, expect, it } from 'vitest'
import { applyThemeToDOM, resolvePalette, ALL_THEME_OPTIONS } from './themes'
import { getParticlePreset, PARTICLE_PRESETS } from './particles'
import { GRADIENT_PRESETS, PATTERN_PRESETS, resolveBackground } from './backgrounds'

describe('theme system', () => {
  it('exposes 11 theme options (4 base + 7 topical)', () => {
    expect(ALL_THEME_OPTIONS).toHaveLength(11)
    expect(ALL_THEME_OPTIONS.filter((t) => t.group === 'base')).toHaveLength(4)
    expect(ALL_THEME_OPTIONS.filter((t) => t.group === 'topical')).toHaveLength(7)
  })

  it('includes a light-dark palette between the light and dark extremes', () => {
    const lightDark = resolvePalette('light-dark')
    expect(lightDark.bg).not.toBe(resolvePalette('light').bg)
    expect(lightDark.bg).not.toBe(resolvePalette('dark').bg)
    expect(ALL_THEME_OPTIONS.find((t) => t.id === 'light-dark')?.name).toBe('Light-Dark')
  })

  it('applyThemeToDOM writes --ug-* CSS variables to documentElement', () => {
    const palette = resolvePalette('dark')
    applyThemeToDOM(palette)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--ug-bg')).toBe(palette.bg)
    expect(root.style.getPropertyValue('--ug-text')).toBe(palette.text)
  })

  it('resolvePalette falls back to light for unknown modes', () => {
    expect(resolvePalette('light')).toBeTruthy()
    expect(resolvePalette('woody')).toBeTruthy()
  })
})

describe('particle presets', () => {
  it('ships 14 presets, each with required config fields', () => {
    expect(PARTICLE_PRESETS).toHaveLength(14)
    for (const p of PARTICLE_PRESETS) {
      expect(p.id).toBeTruthy()
      expect(p.config.count).toBeGreaterThan(0)
      expect(p.config.shape).toBeTruthy()
      expect(p.config.behavior).toBeTruthy()
    }
  })

  it('getParticlePreset returns by id', () => {
    expect(getParticlePreset('fireflies')?.name).toBe('Fireflies')
    expect(getParticlePreset('nope')).toBeUndefined()
  })
})

describe('backgrounds', () => {
  it('ships gradient + pattern preset libraries', () => {
    expect(GRADIENT_PRESETS.length).toBeGreaterThan(0)
    expect(PATTERN_PRESETS.length).toBeGreaterThan(0)
  })

  it('resolveBackground produces CSS for each type', () => {
    expect(resolveBackground({ type: 'solid', value: '#abc' }).background).toBe('#abc')
    const grad = resolveBackground({
      type: 'gradient',
      value: 'linear-gradient(0deg,#000,#fff)',
    })
    expect(grad.background).toContain('linear-gradient')
    const pat = resolveBackground({ type: 'pattern', value: 'url(x)' })
    expect(pat.backgroundRepeat).toBe('repeat')
  })
})
