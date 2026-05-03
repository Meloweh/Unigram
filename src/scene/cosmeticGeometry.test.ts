import { describe, expect, it } from 'vitest'
import {
  chatBubblePathPoints,
  cosmeticNodeDefaults,
  cosmeticTip,
  cosmeticTipFromLocalPoint,
  cosmeticTipHandleLocalPx,
  DEFAULT_COSMETIC_TIP_ANGLE,
  DEFAULT_COSMETIC_TIP_LENGTH,
  thinkingCloudOutlinePoints,
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

  it('samples the legacy arc-puff cloud outline instead of an oval', () => {
    const outline = thinkingCloudOutlinePoints(180, 100)
    expect(outline.length).toBeGreaterThan(50)
    const xs = outline.map(([x]) => x)
    const ys = outline.map(([, y]) => y)
    expect(Math.min(...xs)).toBeLessThan(-80)
    expect(Math.max(...xs)).toBeGreaterThan(80)
    expect(Math.min(...ys)).toBeLessThan(-45)
    expect(Math.max(...ys)).toBeGreaterThan(45)
  })

  it('round-trips cosmetic tip handle positions through drag conversion', () => {
    const bubble = cosmeticTipHandleLocalPx('chat-bubble', 180, 100, Math.PI * 0.75, 24)
    const nextBubble = cosmeticTipFromLocalPoint('chat-bubble', 180, 100, bubble.x, bubble.y)
    expect(nextBubble.angle).toBeCloseTo(Math.PI * 0.75, 2)
    expect(nextBubble.length).toBeGreaterThan(20)

    const cloud = cosmeticTipHandleLocalPx('thinking-cloud', 180, 100, Math.PI * 0.75, 24)
    const nextCloud = cosmeticTipFromLocalPoint('thinking-cloud', 180, 100, cloud.x, cloud.y)
    expect(nextCloud.angle).toBeCloseTo(Math.PI * 0.75, 2)
    expect(nextCloud.length).toBeCloseTo(24, 0)
  })
})
