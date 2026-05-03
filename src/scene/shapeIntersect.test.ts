import { describe, expect, it } from 'vitest'
import { shapeEdgeIntersect } from './shapeIntersect'

describe('shapeEdgeIntersect', () => {
  it('uses the puffy thinking-cloud outline rather than the plain ellipse', () => {
    const cloud = shapeEdgeIntersect('thinking-cloud', 90, 50, 1, 0)
    const oval = shapeEdgeIntersect('oval', 90, 50, 1, 0)
    expect(cloud.x).not.toBeCloseTo(oval.x, 1)
    expect(cloud.x).toBeGreaterThan(80)
    expect(Math.abs(cloud.y)).toBeLessThan(12)
  })
})
