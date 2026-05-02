import { describe, expect, it, beforeEach } from 'vitest'
import { FillGradient } from 'pixi.js'
import {
  NODE_FONT_FAMILY,
  NODE_FONT_SIZE,
  NODE_LABEL_FILL,
  NODE_MIN_H,
  NODE_MIN_W,
  NODE_STROKE_WIDTH,
  _resetGradientCacheForTests,
  nodeFillGradient,
} from './nodeStyle'

beforeEach(() => {
  _resetGradientCacheForTests()
})

describe('nodeStyle constants', () => {
  it('matches legacy 80×40 minimum node size in scene-percent', () => {
    expect(NODE_MIN_W).toBeCloseTo((80 / 1920) * 100, 5)
    expect(NODE_MIN_H).toBeCloseTo((40 / 1080) * 100, 5)
  })
  it('uses a system-font stack', () => {
    expect(NODE_FONT_FAMILY).toMatch(/Segoe UI/)
    expect(NODE_FONT_FAMILY).toMatch(/sans-serif$/)
  })
  it('exposes label fill / font size / stroke width', () => {
    expect(typeof NODE_FONT_SIZE).toBe('number')
    expect(typeof NODE_LABEL_FILL).toBe('number')
    expect(NODE_STROKE_WIDTH).toBeGreaterThan(2)
  })
})

describe('nodeFillGradient', () => {
  it('returns a FillGradient instance', () => {
    const g = nodeFillGradient('#abcdef')
    expect(g).toBeInstanceOf(FillGradient)
  })
  it('caches by colour (case-insensitive)', () => {
    const a = nodeFillGradient('#abcdef')
    const b = nodeFillGradient('#ABCDEF')
    expect(a).toBe(b)
  })
  it('returns distinct instances for different colours', () => {
    const a = nodeFillGradient('#abcdef')
    const b = nodeFillGradient('#123456')
    expect(a).not.toBe(b)
  })
})
