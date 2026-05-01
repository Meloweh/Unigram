import { describe, it, expect } from 'vitest'
import {
  applyZoomStep,
  buildSnapshot,
  CAMERA_SCALE_FINAL,
  createInitialSnapshot,
  isAtRest,
  isHandoffReady,
} from './hybridZoom'

describe('hybridZoom', () => {
  it('initial snapshot is at rest with cameraScale 1', () => {
    const s = createInitialSnapshot()
    expect(s.progress).toBe(0)
    expect(s.nodeProgress).toBe(0)
    expect(s.cameraScale).toBe(1)
    expect(s.nodeInflation).toBe(0)
    expect(s.handoffMode).toBe('host')
    expect(isAtRest(s)).toBe(true)
  })

  it('cameraScale lerps 1→CAMERA_SCALE_FINAL with progress', () => {
    expect(buildSnapshot(0).cameraScale).toBe(1)
    expect(buildSnapshot(0.5).cameraScale).toBeCloseTo((1 + CAMERA_SCALE_FINAL) / 2, 5)
    expect(buildSnapshot(1).cameraScale).toBe(CAMERA_SCALE_FINAL)
  })

  it('clamps progress to [0,1]', () => {
    expect(buildSnapshot(-0.5).progress).toBe(0)
    expect(buildSnapshot(2).progress).toBe(1)
  })

  it('zoom in advances progress and node together when in sync', () => {
    let s = createInitialSnapshot()
    s = applyZoomStep(s, 'in', 0.1)
    expect(s.progress).toBeCloseTo(0.1, 6)
    expect(s.nodeProgress).toBeCloseTo(0.1, 6)
  })

  it('zoom in only advances node when nodeProgress lags', () => {
    const s0 = buildSnapshot(0.5, 0.2)
    const s1 = applyZoomStep(s0, 'in', 0.1)
    expect(s1.progress).toBe(0.5)
    expect(s1.nodeProgress).toBeCloseTo(0.3, 6)
  })

  it('zoom out reduces both', () => {
    const s = applyZoomStep(buildSnapshot(0.6), 'out', 0.1)
    expect(s.progress).toBeCloseTo(0.5, 6)
    expect(s.nodeProgress).toBeCloseTo(0.5, 6)
  })

  it('handoff ready at full progress', () => {
    expect(isHandoffReady(buildSnapshot(1, 1))).toBe(true)
    expect(isHandoffReady(buildSnapshot(0.99, 1))).toBe(false)
    expect(buildSnapshot(1, 1).handoffMode).toBe('child')
  })
})
