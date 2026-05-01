/**
 * Omnigram app shell — stage 1.
 *
 * Mounts the PixiJS renderer once into a host div, wires the store ↔ renderer
 * bridge, attaches pointer/wheel/keyboard controllers, and exposes a
 * "Spawn 2000" dev button to load the bench scene.
 *
 * React renders only the chrome: the FPS overlay and toolbar buttons. The
 * canvas itself is a single div whose children are managed by Pixi.
 */

import { useEffect, useRef, useState } from 'react'
import { SceneRenderer } from '../scene/SceneRenderer'
import { bindStoreToRenderer } from './sceneBridge'
import { PointerController } from '../viewport/PointerController'
import { WheelController } from '../viewport/WheelController'
import { KeyboardController } from '../viewport/KeyboardController'
import { useOmniStore } from '../model/store'
import { spawnGrid, spawnNested } from '../bench/spawnGrid'
import { runScenario, listScenarios, type BenchResult } from '../bench/harness'
import { FpsOverlay } from './FpsOverlay'
import { RightSidebar } from '../ui/RightSidebar'

export function OmnigramApp() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [renderer, setRenderer] = useState<SceneRenderer | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const r = new SceneRenderer()
    let unsubBridge: (() => void) | null = null
    let pointer: PointerController | null = null
    let wheel: WheelController | null = null
    let keyboard: KeyboardController | null = null
    void r.init(host).then(() => {
      if (disposed) {
        r.destroy()
        return
      }
      unsubBridge = bindStoreToRenderer(r)
      pointer = new PointerController(host, r)
      wheel = new WheelController(host, r)
      keyboard = new KeyboardController()
      setRenderer(r)
    }).catch((err: unknown) => {
      // Test/headless environments without WebGL: skip silently.
      console.warn('SceneRenderer.init failed:', err)
    })
    return () => {
      disposed = true
      pointer?.destroy()
      wheel?.destroy()
      keyboard?.destroy()
      unsubBridge?.()
      r.destroy()
      setRenderer(null)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#10131a' }}>
      <div
        ref={hostRef}
        style={{
          position: 'absolute',
          inset: 0,
          touchAction: 'none',
        }}
      />
      <FpsOverlay renderer={renderer} />
      <Toolbar renderer={renderer} />
      <RightSidebar />
    </div>
  )
}

function Toolbar({ renderer }: { renderer: SceneRenderer | null }) {
  const [bench, setBench] = useState<BenchResult | null>(null)
  const [running, setRunning] = useState(false)
  const runBench = async (scenario: string) => {
    if (!renderer || running) return
    setRunning(true)
    setBench(null)
    try {
      const result = await runScenario(scenario, renderer, { durationMs: 3000 })
      setBench(result)
      console.table(result)
    } finally {
      setRunning(false)
    }
  }
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 500 }))}>
          Spawn 500
        </button>
        <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 1000 }))}>
          Spawn 1000
        </button>
        <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 2000 }))}>
          Spawn 2000
        </button>
        <button
          onClick={() =>
            useOmniStore
              .getState()
              .loadModel(spawnGrid({ count: 100, spacingPercent: 9, mixedShapes: true }))
          }
        >
          Shapes demo
        </button>
        <button
          onClick={() => {
            const { root, children } = spawnNested()
            const store = useOmniStore.getState()
            for (const c of children) store.registerModel(c)
            store.loadModel(root)
          }}
          title="RMM demo: select a parent node and scroll up to zoom into its child model"
        >
          Spawn Nested
        </button>
        <button onClick={() => useOmniStore.getState().undo()}>Undo</button>
        <button onClick={() => useOmniStore.getState().redo()}>Redo</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {listScenarios().map((s) => (
          <button key={s} disabled={!renderer || running} onClick={() => void runBench(s)}>
            Bench: {s}
          </button>
        ))}
      </div>
      {bench && (
        <div
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: '#cfe',
            padding: '6px 10px',
            font: '11px monospace',
            borderRadius: 4,
            whiteSpace: 'pre',
          }}
        >
          {`${bench.scenario}  frames=${bench.frames}  p50=${bench.fpsP50}  p95=${bench.fpsP95}  min=${bench.fpsMin}  max=${bench.fpsMax}`}
        </div>
      )}
    </div>
  )
}
