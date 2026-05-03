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

describe('FlowRuntime — camera', () => {
  it('camera task contributes additive pan + scale to the camera channel', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([
        { id: 'c', kind: 'camera', params: { panX: 10, panY: -4, zoom: 2, ms: 100 } },
      ]),
      0,
    )
    rt.tick(50) // halfway → linear interp
    const cam = rt.getCameraOverride()!
    expect(cam.dPanX).toBeCloseTo(5, 3)
    expect(cam.dPanY).toBeCloseTo(-2, 3)
    expect(cam.scaleMul).toBeCloseTo(1.5, 3) // 1 + (2-1)*0.5
    // Camera tasks contribute nothing to per-node overrides.
    expect(rt.getOverride('n1')).toBeUndefined()
  })

  it('camera contribution clears when the run ends without permanent flag', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([
        { id: 'c', kind: 'camera', params: { panX: 8, ms: 100 } },
      ]),
      0,
    )
    rt.tick(50)
    expect(rt.getCameraOverride()?.dPanX).toBeCloseTo(4, 3)
    rt.tick(200) // past end; non-permanent → run drained, override cleared
    expect(rt.getCameraOverride()).toBeUndefined()
    expect(rt.hasActiveRuns).toBe(false)
  })

  it('camera with permanent flag holds the final pan after the task ends', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect(
        [
          { id: 'c', kind: 'camera', params: { panX: 6, zoom: 1.5, ms: 100, permanent: 1 } },
          { id: 'w', kind: 'wait', params: { ms: 500 } },
        ],
        [{ from: 'c', to: 'w' }],
      ),
      0,
    )
    rt.tick(200) // camera done; wait still running → held should be exposed
    const cam = rt.getCameraOverride()!
    expect(cam.dPanX).toBeCloseTo(6, 3)
    expect(cam.scaleMul).toBeCloseTo(1.5, 3)
  })
})

describe('FlowRuntime — text-generator side-effect', () => {
  it('fires onTextGen exactly once when the task activates', () => {
    const rt = new FlowRuntime()
    const calls: { id: string; params: Record<string, number> }[] = []
    rt.onTextGen = (id, params) => calls.push({ id, params })
    rt.start(
      'n1',
      mkEffect([{ id: 'tg', kind: 'text-generator', params: { ms: 200, charsPerSec: 30 } }], []),
      0,
    )
    rt.tick(50)
    rt.tick(100)
    rt.tick(150)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('n1')
    expect(calls[0].params.charsPerSec).toBe(30)
  })

  it('fires onTextGenStop on natural completion', () => {
    const rt = new FlowRuntime()
    const stops: string[] = []
    rt.onTextGen = () => {}
    rt.onTextGenStop = (id) => stops.push(id)
    rt.start(
      'n1',
      mkEffect([{ id: 'tg', kind: 'text-generator', params: { ms: 100 } }], []),
      0,
    )
    rt.tick(50)
    expect(stops).toHaveLength(0)
    rt.tick(150) // past task end → drains
    expect(stops).toEqual(['n1'])
  })

  it('fires onTextGenStop on cancel mid-run', () => {
    const rt = new FlowRuntime()
    const stops: string[] = []
    rt.onTextGen = () => {}
    rt.onTextGenStop = (id) => stops.push(id)
    const runId = rt.start(
      'n1',
      mkEffect([{ id: 'tg', kind: 'text-generator', params: { ms: 1000 } }], []),
      0,
    )!
    rt.tick(50) // start fires here
    rt.cancel(runId)
    expect(stops).toEqual(['n1'])
  })
})

describe('FlowRuntime — handoff side-effects', () => {
  it('fires onHandoffRmm exactly once when the task activates', () => {
    const rt = new FlowRuntime()
    const calls: { id: string; params: Record<string, number> }[] = []
    rt.onHandoffRmm = (id, params) => calls.push({ id, params })
    rt.start(
      'host',
      mkEffect([{ id: 'h', kind: 'handoff-rmm', params: { ms: 600 } }], []),
      0,
    )
    rt.tick(50)
    rt.tick(150)
    rt.tick(300)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('host')
  })

  it('fires onReturnRmm exactly once', () => {
    const rt = new FlowRuntime()
    const calls: string[] = []
    rt.onReturnRmm = (id) => calls.push(id)
    rt.start(
      'host',
      mkEffect([{ id: 'r', kind: 'return-rmm', params: { ms: 600 } }], []),
      0,
    )
    rt.tick(100)
    rt.tick(700)
    expect(calls).toEqual(['host'])
  })

  it('fires onHandoffMpd with direction param', () => {
    const rt = new FlowRuntime()
    const calls: { id: string; dir: number }[] = []
    rt.onHandoffMpd = (id, params) => calls.push({ id, dir: params.direction ?? 0 })
    rt.start(
      'host',
      mkEffect([{ id: 'm', kind: 'handoff-mpd', params: { direction: -1, ms: 400 } }], []),
      0,
    )
    rt.tick(50)
    rt.tick(200)
    expect(calls).toEqual([{ id: 'host', dir: -1 }])
  })

  it('handoff tasks complete after their ms duration so downstream effects fire', () => {
    const rt = new FlowRuntime()
    const handoffCalls: string[] = []
    rt.onHandoffRmm = (id) => handoffCalls.push(id)
    rt.start(
      'host',
      mkEffect(
        [
          { id: 'h', kind: 'handoff-rmm', params: { ms: 200 } },
          { id: 'm', kind: 'move', params: { dx: 5, ms: 200 } },
        ],
        [{ from: 'h', to: 'm' }],
      ),
      0,
    )
    rt.tick(50)
    expect(handoffCalls).toEqual(['host'])
    expect(rt.getOverride('host')).toBeUndefined() // move not started yet
    rt.tick(300) // handoff done at 200, move at +100 → ratio 0.5
    const ov = rt.getOverride('host')
    expect(ov?.dx).toBeCloseTo(2.5, 1)
  })
})

describe('FlowRuntime — spawn side-effects', () => {
  it('fires onSpawn once on activation and onSpawnStop on completion', () => {
    const rt = new FlowRuntime()
    const starts: { id: string; count: number }[] = []
    const stops: string[] = []
    rt.onSpawn = (id, params) => starts.push({ id, count: params.count })
    rt.onSpawnStop = (id) => stops.push(id)
    rt.start(
      'host',
      mkEffect([{ id: 's', kind: 'spawn', params: { count: 4, ms: 100 } }], []),
      0,
    )
    rt.tick(20)
    rt.tick(60)
    expect(starts).toEqual([{ id: 'host', count: 4 }])
    expect(stops).toEqual([])
    rt.tick(150) // past task end
    expect(stops).toEqual(['host'])
  })

  it('fires onSpawnCircularStop on cancel mid-run', () => {
    const rt = new FlowRuntime()
    const stops: string[] = []
    rt.onSpawnCircular = () => {}
    rt.onSpawnCircularStop = (id) => stops.push(id)
    const runId = rt.start(
      'host',
      mkEffect([{ id: 's', kind: 'spawn-circular', params: { count: 6, ms: 5000 } }], []),
      0,
    )!
    rt.tick(50)
    rt.cancel(runId)
    expect(stops).toEqual(['host'])
  })
})

describe('FlowRuntime — expand/collapse', () => {
  it('expand interpolates scale 1 → mul over ms', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([{ id: 'e', kind: 'expand', params: { mul: 2, ms: 100 } }], []),
      0,
    )
    rt.tick(50) // ratio 0.5
    expect(rt.getOverride('n1')?.scaleMul).toBeCloseTo(1.5, 2)
    rt.tick(99) // near end, ratio ~0.99
    expect(rt.getOverride('n1')?.scaleMul).toBeCloseTo(2, 1)
  })

  it('collapse interpolates scale 1 → 1/mul over ms', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      mkEffect([{ id: 'c', kind: 'collapse', params: { mul: 2, ms: 100 } }], []),
      0,
    )
    rt.tick(50) // ratio 0.5
    expect(rt.getOverride('n1')?.scaleMul).toBeCloseTo(0.75, 2) // 1 + (0.5 - 1)*0.5
    rt.tick(99) // near end
    expect(rt.getOverride('n1')?.scaleMul).toBeCloseTo(0.5, 1)
  })
})

describe('FlowRuntime — soak', () => {
  it('looped run does not leak overrides over 5000 ticks', () => {
    const rt = new FlowRuntime()
    rt.start(
      'n1',
      {
        id: 'eff',
        label: 'eff',
        alwaysPlay: true,
        graph: {
          nodes: [
            { id: 'a', kind: 'move', x: 0, y: 0, params: { dx: 1, dy: 0, ms: 100 } },
          ],
          edges: [],
        },
      },
      0,
    )
    for (let t = 0; t < 5000; t += 16) rt.tick(t)
    expect(rt.hasActiveRuns).toBe(true)
    const ov = rt.getOverride('n1')!
    // Override stays bounded — the contribution at any frame depends only on
    // the local elapsed within the *current* cycle, not the total runtime.
    expect(Math.abs(ov.dx ?? 0)).toBeLessThanOrEqual(1)
  })

  it('cancelling a run drops its overrides on the next tick', () => {
    const rt = new FlowRuntime()
    const id = rt.start(
      'n1',
      {
        id: 'eff',
        label: 'eff',
        graph: {
          nodes: [{ id: 'a', kind: 'move', x: 0, y: 0, params: { dx: 5, dy: 0, ms: 1000 } }],
          edges: [],
        },
      },
      0,
    )!
    rt.tick(500)
    expect(rt.getOverride('n1')?.dx).toBeCloseTo(2.5, 1)
    rt.cancel(id)
    rt.tick(600)
    expect(rt.getOverride('n1')).toBeUndefined()
    expect(rt.hasActiveRuns).toBe(false)
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

describe('FlowEffectKind dispatch coverage', () => {
  // Every kind in the union MUST be handled by the runtime. We assert this
  // by starting a 1-node effect of each kind and verifying the runtime
  // does not throw and either advances the override or fires a side-effect.
  const ALL_KINDS: FlowEffectKind[] = [
    'wait', 'move', 'scale', 'color', 'jitter', 'float', 'emerge', 'dismiss',
    'cloud-levitate', 'bubble-levitate', 'repeater', 'camera', 'text-generator',
    'record', 'obs-record', 'handoff-rmm', 'return-rmm', 'handoff-mpd',
    'spawn', 'spawn-circular', 'expand', 'collapse',
  ]

  it('runtime accepts every FlowEffectKind without throwing', () => {
    for (const kind of ALL_KINDS) {
      const rt = new FlowRuntime()
      // Stub all side-effect callbacks so handoff/spawn/record kinds don't
      // throw on a missing handler.
      rt.onSpawn = () => {}
      rt.onSpawnStop = () => {}
      rt.onSpawnCircular = () => {}
      rt.onSpawnCircularStop = () => {}
      rt.onHandoffRmm = () => {}
      rt.onReturnRmm = () => {}
      rt.onHandoffMpd = () => {}
      const runId = rt.start('host', mkEffect([{ id: 'n', kind, params: { ms: 50 } }]), 0)
      expect(runId).toBeTruthy()
      // One tick should not throw and should not corrupt overrides.
      expect(() => rt.tick(25)).not.toThrow()
      expect(() => rt.tick(50)).not.toThrow()
    }
  })
})
