/**
 * Shape narrow-phase hit-test sanity checks. Geometry coverage is by-eye in
 * the dev UI; these tests pin the boundary cases that matter for the picker.
 */

import { describe, expect, it } from 'vitest'
import { pointInShape } from './shapes'

describe('pointInShape — rectangles', () => {
  it('inside rect', () => {
    expect(pointInShape('rectangle', 0, 0, 10, 5)).toBe(true)
    expect(pointInShape('rectangle', 4.9, 2.4, 10, 5)).toBe(true)
  })
  it('outside rect', () => {
    expect(pointInShape('rectangle', 6, 0, 10, 5)).toBe(false)
    expect(pointInShape('rectangle', 0, 3, 10, 5)).toBe(false)
  })
})

describe('pointInShape — circle / oval', () => {
  it('circle uses min(w,h) radius', () => {
    expect(pointInShape('circle', 0, 0, 10, 4)).toBe(true)
    expect(pointInShape('circle', 1.9, 0, 10, 4)).toBe(true)
    expect(pointInShape('circle', 2.1, 0, 10, 4)).toBe(false)
  })
  it('oval is anisotropic', () => {
    expect(pointInShape('oval', 4.9, 0, 10, 4)).toBe(true)
    expect(pointInShape('oval', 4.9, 1.9, 10, 4)).toBe(false)
  })
})

describe('pointInShape — diamond', () => {
  it('rejects rect corners', () => {
    expect(pointInShape('diamond', 4.9, 2.4, 10, 5)).toBe(false)
    expect(pointInShape('diamond', 0, 0, 10, 5)).toBe(true)
    // On the long axis only.
    expect(pointInShape('diamond', 4.9, 0, 10, 5)).toBe(true)
  })
})

describe('pointInShape — triangle', () => {
  it('rejects upper corners', () => {
    // Triangle apex at top-centre, base on bottom.
    expect(pointInShape('triangle', -4, -2, 10, 5)).toBe(false)
    expect(pointInShape('triangle', 4, -2, 10, 5)).toBe(false)
    expect(pointInShape('triangle', 0, 2, 10, 5)).toBe(true)
  })
})

describe('pointInShape — cosmetic', () => {
  it('chat-bubble + thinking-cloud accept body and nearby overhang', () => {
    expect(pointInShape('chat-bubble', 4, 2, 10, 5)).toBe(true)
    expect(pointInShape('thinking-cloud', -3, -2, 10, 5)).toBe(true)
    expect(pointInShape('chat-bubble', 6, 0, 10, 5)).toBe(true)
    expect(pointInShape('chat-bubble', 10, 0, 10, 5)).toBe(false)
  })
})
