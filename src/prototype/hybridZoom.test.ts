import {
  applyZoomStep,
  buildSnapshot,
  createInitialSnapshot,
  realignPanOffset,
} from './hybridZoom'

describe('hybrid zoom continuity', () => {
  it('keeps camera and node growth monotonic during inward zoom', () => {
    let current = createInitialSnapshot()

    for (let i = 0; i < 8; i += 1) {
      const next = applyZoomStep(current, 'in', 0.1)
      expect(next.progress).toBeGreaterThanOrEqual(current.progress)
      expect(next.cameraScale).toBeGreaterThanOrEqual(current.cameraScale)
      expect(next.nodeInflation).toBeGreaterThanOrEqual(current.nodeInflation)
      current = next
    }
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
    expect(resumed.cameraScale - paused.cameraScale).toBeLessThan(0.1)
    expect(resumed.nodeInflation - paused.nodeInflation).toBeLessThan(0.2)
  })

  it('realigns pan offset smoothly when zoom resumes', () => {
    const pan = realignPanOffset({ x: 100, y: -50 })
    expect(pan.x).toBeCloseTo(82)
    expect(pan.y).toBeCloseTo(-41)
  })
})
