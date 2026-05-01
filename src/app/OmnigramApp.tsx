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
import { spawnGrid } from '../bench/spawnGrid'
import { FpsOverlay } from './FpsOverlay'

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
      <Toolbar />
    </div>
  )
}

function Toolbar() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        display: 'flex',
        gap: 6,
        zIndex: 10,
      }}
    >
      <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 500 }))}>
        Spawn 500
      </button>
      <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 1000 }))}>
        Spawn 1000
      </button>
      <button onClick={() => useOmniStore.getState().loadModel(spawnGrid({ count: 2000 }))}>
        Spawn 2000
      </button>
      <button onClick={() => useOmniStore.getState().undo()}>Undo</button>
      <button onClick={() => useOmniStore.getState().redo()}>Redo</button>
    </div>
  )
}
