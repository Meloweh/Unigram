import { describe, expect, it } from 'vitest'
import { FlowRuntime } from './runtime'
import type { FlowEffect, FlowEffectKind } from './types'
import { mergeOverride } from './types'

const mkEffect = (
  nodes: { id: string; kind: FlowEffectKind; params?: Record<string, number> }[],
  edges: { from: string; to: string }[] = [],
): FlowEffect => ({
  id: 'eff',
  label: 'eff',
  graph: {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      x: 0,
      y: 0,
      params: n.params ?? {},
    })),
    edges,
  },
})

describe('FlowRuntime', () => {
  it('starts and completes a simple wait task', () => {
    const rt = new FlowRuntime()
    const id = rt.start('n1', mkEffect([{ id: 'a', kind: 'wait', params: { ms: 100 } }]), 0)
    expect(id).not.toBeNull()
    expect(rt.hasActiveRuns).toBe(true)
    rt.tick(50) // mid
    expect(rt.hasActiveRuns).toBe(true)
    rt.tick(100) // exact end → ratio 1, task ends
    rt.tick(101) // sweep dropper
    expect(rt.hasActiveRuns).toBe(false)
  })

  it('respects topological order via dependsOn (move starts after wait)', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect(
        [
          { id: 'w', kind: 'wait', params: { ms: 100 } },
          { id: 'm', kind: 'move', params: { dx: 10, dy: 0, ms: 100 } },
        ],
        [{ from: 'w', to: 'm' }],
      ),
      0,
    )
    rt.tick(50) // wait still running, move not started
    expect(rt.getOverride('n1')).toBeUndefined()
    rt.tick(150) // wait done at t=100, move running for 50ms → ratio 0.5
    const ov = rt.getOverride('n1')
    expect(ov?.dx).toBeCloseTo(5, 1)
  })

  it('rejects cyclic graphs', () => {
    const rt = new FlowRuntime()
    const id = rt.start(
      'n1',
      mkEffect(
        [
          { id: 'a', kind: 'wait', params: { ms: 50 } },
          { id: 'b', kind: 'wait', params: { ms: 50 } },
        ],
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      ),
      0,
    )
    expect(id).toBeNull()
  })

  it('cancel drops the run immediately', () => {
    const rt = new FlowRuntime()
    const id = rt.start('n1', mkEffect([{ id: 'a', kind: 'move', params: { dx: 10, ms: 1000 } }]), 0)!
    rt.cancel(id)
    rt.tick(100)
    expect(rt.getOverride('n1')).toBeUndefined()
    expect(rt.hasActiveRuns).toBe(false)
  })

  it('alwaysPlay loops past total cycle length', () => {
    const rt = new FlowRuntime()
    const eff: FlowEffect = {
      ...mkEffect([{ id: 'm', kind: 'move', params: { dx: 100, ms: 100 } }]),
      alwaysPlay: true,
    }
    rt.start('n1', eff, 0)
    rt.tick(50)
    expect(rt.getOverride('n1')!.dx).toBeCloseTo(50)
    rt.tick(120) // past the first cycle; loop rewinds, ratio = 0.2 of cycle 2
    expect(rt.hasActiveRuns).toBe(true)
    expect(rt.getOverride('n1')!.dx).toBeCloseTo(20)
  })

  it('move contributes proportional offset', () => {
    const rt = new FlowRuntime()
    rt.start('n1', mkEffect([{ id: 'm', kind: 'move', params: { dx: 20, dy: 10, ms: 100 } }]), 0)
    rt.tick(25)
    const ov = rt.getOverride('n1')!
    expect(ov.dx).toBeCloseTo(5)
    expect(ov.dy).toBeCloseTo(2.5)
  })

  it('scale lerps from 1 to mul', () => {
    const rt = new FlowRuntime()
    rt.start('n1', mkEffect([{ id: 's', kind: 'scale', params: { mul: 2, ms: 100 } }]), 0)
    rt.tick(50)
    expect(rt.getOverride('n1')?.scaleMul).toBeCloseTo(1.5)
  })

  it('color lerps tint from white toward target', () => {
    const rt = new FlowRuntime()
    rt.start('n1', mkEffect([{ id: 'c', kind: 'color', params: { tint: 0xff0000, ms: 100 } }]), 0)
    rt.tick(50)
    const tint = rt.getOverride('n1')!.tint!
    // Halfway from white (0xffffff) to red (0xff0000): R≈255, G≈128, B≈128.
    expect((tint >> 16) & 0xff).toBe(255)
    expect((tint >> 8) & 0xff).toBeGreaterThan(120)
    expect((tint >> 8) & 0xff).toBeLessThan(140)
  })

  it('jitter produces a non-zero bounded offset', () => {
    const rt = new FlowRuntime()
    rt.start('n1', mkEffect([{ id: 'j', kind: 'jitter', params: { amp: 5, ms: 1000 } }]), 0)
    rt.tick(50)
    const ov = rt.getOverride('n1')!
    expect(Math.abs(ov.dx ?? 0)).toBeLessThanOrEqual(5)
    expect(Math.abs(ov.dy ?? 0)).toBeLessThanOrEqual(5)
  })
})

describe('FlowRuntime — extended kinds', () => {
  it('move with roundtrip returns to origin at midpoint of lifetime peak', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([{ id: 'm', kind: 'move', params: { dx: 10, dy: 0, ms: 100, roundtrip: 1 } }]),
      0,
    )
    rt.tick(50) // sin(π/2) = 1 → max displacement
    expect(rt.getOverride('n1')!.dx).toBeCloseTo(10, 1)
    rt.tick(99) // approaching end → ~0
    expect(rt.getOverride('n1')!.dx).toBeLessThan(1)
  })

  it('emerge ramps alpha and scale 0→1', () => {
    const rt = new FlowRuntime()
    rt.start('n1', mkEffect([{ id: 'e', kind: 'emerge', params: { ms: 100 } }]), 0)
    rt.tick(50)
    const ov = rt.getOverride('n1')!
    expect(ov.alphaMul).toBeCloseTo(0.5, 2)
    expect(ov.scaleMul).toBeCloseTo(0.5, 2)
  })

  it('dismiss ramps alpha and scale 1→0', () => {
    const rt = new FlowRuntime()
    rt.start('n1', mkEffect([{ id: 'd', kind: 'dismiss', params: { ms: 100 } }]), 0)
    rt.tick(50)
    const ov = rt.getOverride('n1')!
    expect(ov.alphaMul).toBeCloseTo(0.5, 2)
    expect(ov.scaleMul).toBeCloseTo(0.5, 2)
  })

  it('float produces a bounded vertical sin offset', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([{ id: 'f', kind: 'float', params: { amp: 2, freq: 1, ms: 1000 } }]),
      0,
    )
    rt.tick(250) // ¼ period at 1Hz → sin(π/2) = 1 → dy = 2
    expect(rt.getOverride('n1')!.dy).toBeCloseTo(2, 1)
    expect(rt.getOverride('n1')!.dx ?? 0).toBe(0)
  })

  it('cloud-levitate offsets both axes', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([{ id: 'c', kind: 'cloud-levitate', params: { ampX: 1, ampY: 1, freq: 1, ms: 1000 } }]),
      0,
    )
    rt.tick(250)
    const ov = rt.getOverride('n1')!
    // Each axis bounded by its amp.
    expect(Math.abs(ov.dx ?? 0)).toBeLessThanOrEqual(1.0001)
    expect(Math.abs(ov.dy ?? 0)).toBeLessThanOrEqual(1.0001)
  })

  it('bubble-levitate combines dy with a scale pulse near 1', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([{ id: 'b', kind: 'bubble-levitate', params: { ampY: 1, scaleAmp: 0.05, freq: 1, ms: 1000 } }]),
      0,
    )
    rt.tick(125)
    const ov = rt.getOverride('n1')!
    expect(ov.scaleMul).toBeGreaterThan(0.95)
    expect(ov.scaleMul).toBeLessThan(1.05)
  })

  it('repeater rewinds the run a finite number of times', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect(
        [
          { id: 'm', kind: 'move', params: { dx: 10, dy: 0, ms: 100 } },
          { id: 'r', kind: 'repeater', params: { times: 2 } },
        ],
        [{ from: 'm', to: 'r' }],
      ),
      0,
    )
    rt.tick(50)
    expect(rt.hasActiveRuns).toBe(true)
    // Cycle 1 ends at 100; repeater consumes 1 → cycle 2 starts.
    rt.tick(150)
    expect(rt.hasActiveRuns).toBe(true)
    // Cycle 2 ends at 200; repeater consumes 2nd → cycle 3 starts.
    rt.tick(250)
    expect(rt.hasActiveRuns).toBe(true)
    // Past the 3rd cycle end (300).
    rt.tick(350)
    expect(rt.hasActiveRuns).toBe(false)
  })

  it('color with permanent flag holds tint after task ends', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect(
        [
          { id: 'c', kind: 'color', params: { tint: 0xff0000, ms: 100, permanent: 1 } },
          { id: 'w', kind: 'wait', params: { ms: 500 } },
        ],
        [{ from: 'c', to: 'w' }],
      ),
      0,
    )
    rt.tick(150) // color done; wait running
    expect(rt.getOverride('n1')?.tint).toBe(0xff0000)
  })

  it('scale with permanent flag holds final scale after task ends', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect(
        [
          { id: 's', kind: 'scale', params: { mul: 1.5, ms: 100, permanent: 1 } },
          { id: 'w', kind: 'wait', params: { ms: 500 } },
        ],
        [{ from: 's', to: 'w' }],
      ),
      0,
    )
    rt.tick(200)
    expect(rt.getOverride('n1')?.scaleMul).toBeCloseTo(1.5, 3)
  })
})

describe('mergeOverride', () => {
  it('adds offsets and multiplies scale/alpha/tint', () => {
    const m = mergeOverride(
      { dx: 1, dy: 2, scaleMul: 2, alphaMul: 0.5, tint: 0xff0000 },
      { dx: 3, dy: 4, scaleMul: 1.5, alphaMul: 0.5, tint: 0x808080 },
    )
    expect(m.dx).toBe(4)
    expect(m.dy).toBe(6)
    expect(m.scaleMul).toBe(3)
    expect(m.alphaMul).toBe(0.25)
    // 0xff0000 * 0x808080: red 255*128/255 = 128, others 0.
    expect((m.tint! >> 16) & 0xff).toBe(128)
  })
})
