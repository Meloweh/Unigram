import { describe, expect, it } from 'vitest'
import {
  chatBubblePathPoints,
  cosmeticNodeDefaults,
  cosmeticTip,
  DEFAULT_COSMETIC_TIP_ANGLE,
  DEFAULT_COSMETIC_TIP_LENGTH,
  thinkingCloudTrail,
} from './cosmeticGeometry'

describe('cosmetic geometry', () => {
  it('provides legacy-like defaults for new cosmetic nodes', () => {
    const d = cosmeticNodeDefaults('chat-bubble')
    expect(d.shape).toBe('chat-bubble')
    expect(d.cosmeticType).toBe('chat-bubble')
    expect(d.w).toBeCloseTo(9.375)
    expect(d.h).toBeCloseTo(9.259)
    expect(d.tipAngle).toBe(DEFAULT_COSMETIC_TIP_ANGLE)
    expect(d.tipLength).toBe(DEFAULT_COSMETIC_TIP_LENGTH)
  })

  it('derives angle and length from legacy tip fallback', () => {
    const tip = cosmeticTip({ tip: { x: 3, y: 4 } })
    expect(tip.angle).toBeCloseTo(Math.atan2(4, 3))
    expect(tip.length).toBeCloseTo(5)
  })

  it('places chat-bubble tails on top or bottom depending on angle', () => {
    expect(chatBubblePathPoints(180, 100, Math.PI / 2).isBottom).toBe(true)
    expect(chatBubblePathPoints(180, 100, -Math.PI / 2).isBottom).toBe(false)
  })

  it('uses three legacy thought trail circles', () => {
    const trail = thinkingCloudTrail(180, 100, DEFAULT_COSMETIC_TIP_ANGLE, DEFAULT_COSMETIC_TIP_LENGTH)
    expect(trail).toHaveLength(3)
    expect(trail.map((c) => c.r)).toEqual([8, 6, 4])
  })
})
