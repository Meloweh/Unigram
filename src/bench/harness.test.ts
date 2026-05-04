import { describe, expect, it } from 'vitest'
import { listScenarios } from './harness'

describe('bench harness', () => {
  it('registers all expected scenarios', () => {
    const names = listScenarios()
    // Camera scenarios from the original Stage 2 set.
    expect(names).toContain('pan-h')
    expect(names).toContain('pan-loop')
    expect(names).toContain('zoom-pulse')
    expect(names).toContain('pan-zoom')
    expect(names).toContain('edge-heavy-2k')
    expect(names).toContain('idle')
    // Stage 3 RMM zoom acceptance.
    expect(names).toContain('rmm-zoom')
    // Stage 5 effects acceptance — ≥60 FPS @ 500 nodes with effects.
    expect(names).toContain('effects-500')
    // Cosmetic node geometry acceptance — 1k mixed standard/cosmetic nodes.
    expect(names).toContain('cosmetic-mixed-1k')
    // Large-selection drag regression: 2k nodes, 300 selected.
    expect(names).toContain('multi-drag-2k')
  })

  it('every scenario name is unique', () => {
    const names = listScenarios()
    expect(new Set(names).size).toBe(names.length)
  })
})
