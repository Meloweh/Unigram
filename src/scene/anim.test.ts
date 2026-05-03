import { describe, it, expect } from 'vitest'
import { easeInOutSine, easeOutCubic, lerp, loopPhase, pulse01 } from './anim'

describe('anim', () => {
  it('lerp interpolates endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.5)).toBe(5)
  })

  it('easeOutCubic clamps and is monotonic', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25) // accelerates early
    expect(easeOutCubic(0.5)).toBeLessThan(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(easeOutCubic(0.25))
  })

  it('easeInOutSine is symmetric around 0.5', () => {
    expect(easeInOutSine(0)).toBe(0)
    expect(easeInOutSine(1)).toBe(1)
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 5)
    expect(easeInOutSine(0.25) + easeInOutSine(0.75)).toBeCloseTo(1, 5)
  })

  it('pulse01 is in [0,1] and zero at period boundaries', () => {
    expect(pulse01(0, 1000)).toBeCloseTo(0, 5)
    expect(pulse01(1000, 1000)).toBeCloseTo(0, 5)
    expect(pulse01(500, 1000)).toBeCloseTo(1, 5)
    expect(pulse01(250, 1000)).toBeCloseTo(0.5, 5)
    expect(pulse01(123, 0)).toBe(0)
  })

  it('loopPhase wraps in [0,1)', () => {
    expect(loopPhase(0, 100)).toBe(0)
    expect(loopPhase(50, 100)).toBe(0.5)
    expect(loopPhase(100, 100)).toBe(0)
    expect(loopPhase(123, 100)).toBeCloseTo(0.23, 5)
    expect(loopPhase(1, 0)).toBe(0)
  })
})
