import {
  applyZoomStep,
  buildSnapshot,
  createInitialSnapshot,
  realignPanOffset,
} from './hybridZoom'

describe('hybrid zoom continuity', () => {
  it('keeps camera and canvas reveal monotonic during inward zoom', () => {
    let current = createInitialSnapshot()

    for (let i = 0; i < 8; i += 1) {
      const next = applyZoomStep(current, 'in', 0.1)
      expect(next.progress).toBeGreaterThanOrEqual(current.progress)
      expect(next.cameraScale).toBeGreaterThanOrEqual(current.cameraScale)
      expect(next.nodeInflation).toBeGreaterThanOrEqual(current.nodeInflation)
      current = next
    }

    // nodeInflation is a canvas reveal factor (0→1), matching progress
    expect(current.nodeInflation).toBeCloseTo(0.8)
    // cameraScale grows from 1→1.8
    expect(current.cameraScale).toBeCloseTo(1.64)
  })

  it('switches to child handoff exactly at full progress', () => {
    const before = buildSnapshot(0.999)
    const at = buildSnapshot(1)
    expect(before.handoffMode).toBe('host')
    expect(at.handoffMode).toBe('child')
  })

  it('supports pause-resume continuity by preserving snapshot values across idle periods', () => {
    const paused = buildSnapshot(0.46)
    const resumed = applyZoomStep(paused, 'in', 0.04)

    expect(resumed.progress).toBeGreaterThan(paused.progress)
    expect(resumed.cameraScale - paused.cameraScale).toBeLessThan(0.06)
    expect(resumed.nodeInflation - paused.nodeInflation).toBeLessThan(0.2)
  })

  it('realigns pan offset smoothly when zoom resumes', () => {
    const pan = realignPanOffset({ x: 100, y: -50 })
    expect(pan.x).toBeCloseTo(82)
    expect(pan.y).toBeCloseTo(-41)
  })

  it('node catches up to camera when nodeProgress lags behind', () => {
    // Simulate a mid-zoom node switch: camera at 0.5 but nodeProgress at 0
    const afterSwitch = buildSnapshot(0.5, 0)
    expect(afterSwitch.cameraScale).toBeGreaterThan(1) // camera zoomed
    expect(afterSwitch.nodeInflation).toBe(0) // node not inflated

    // Zoom in — should only advance nodeProgress
    const step1 = applyZoomStep(afterSwitch, 'in')
    expect(step1.progress).toBeCloseTo(0.5) // camera holds
    expect(step1.nodeProgress).toBeCloseTo(0.08) // node catching up
    expect(step1.nodeInflation).toBeCloseTo(0.08)

    // Keep zooming until caught up, then both advance
    let s = afterSwitch
    for (let i = 0; i < 10; i++) s = applyZoomStep(s, 'in')
    expect(s.nodeProgress).toBeCloseTo(s.progress)
    expect(s.progress).toBeGreaterThan(0.5) // camera resumed
  })
})
