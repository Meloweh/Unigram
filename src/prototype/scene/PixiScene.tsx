/**
 * PixiScene — React component that owns the PixiJS Application lifecycle.
 *
 * Creates a <canvas> that sits behind (or replaces) the DOM scene.
 * Exposes the Application + layer containers via PixiSceneContext so
 * child renderers can add/remove PixiJS display objects.
 *
 * Transform sync: every frame, the sceneContainer's position and scale
 * are set to match the CSS transform applied to the DOM .scene div.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Application, Container } from 'pixi.js'
import { pixiLayers } from './pixiLayers'
import { SCENE_W, SCENE_H } from './sceneConstants'

// ─── Context ──────────────────────────────────────────────────────────

export interface PixiSceneCtx {
  app: Application
  /** Root container — transform synced to pan/zoom/rotate */
  sceneContainer: Container
  /** Layer for connection Graphics (bottom) */
  connectionsLayer: Container
  /** Layer for node Containers (middle) */
  nodesLayer: Container
  /** Layer for overlays: selection rect, draft line, resize handles (top) */
  overlaysLayer: Container
}

const PixiSceneContext = createContext<PixiSceneCtx | null>(null)

export function usePixiScene(): PixiSceneCtx | null {
  return useContext(PixiSceneContext)
}

// ─── Props ────────────────────────────────────────────────────────────

interface PixiSceneProps {
  /** CSS translate X of the scene (auto-center + panOffset) */
  sceneTx: number
  /** CSS translate Y of the scene */
  sceneTy: number
  /** Combined camera scale (snapshot.cameraScale * freeScale) */
  effectiveScale: number
  /** Flow-driven rotation in degrees */
  rotation: number
  /** Viewport pixel size */
  vpSize: { w: number; h: number }
  children?: ReactNode
}

// ─── Component ────────────────────────────────────────────────────────

export function PixiScene({ sceneTx, sceneTy, effectiveScale, rotation, vpSize, children }: PixiSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ctx, setCtx] = useState<PixiSceneCtx | null>(null)

  // Store transform props in refs so the ticker can read latest values
  // without causing PixiJS re-init on every pan frame.
  const txRef = useRef(sceneTx)
  const tyRef = useRef(sceneTy)
  const scaleRef = useRef(effectiveScale)
  const rotRef = useRef(rotation)
  const vpRef = useRef(vpSize)
  txRef.current = sceneTx
  tyRef.current = sceneTy
  scaleRef.current = effectiveScale
  rotRef.current = rotation
  vpRef.current = vpSize

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // PixiJS requires a real GPU context — skip in test/SSR environments
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return
    const probe = document.createElement('canvas')
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return

    const app = new Application()
    let destroyed = false
    let initialized = false

    const sceneContainer = new Container()
    const connectionsLayer = new Container()
    const nodesLayer = new Container()
    const overlaysLayer = new Container()
    sceneContainer.addChild(connectionsLayer)
    sceneContainer.addChild(nodesLayer)
    sceneContainer.addChild(overlaysLayer)

    app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    }).then(() => {
      if (destroyed) { app.destroy(true); return }
      initialized = true

      // Size the renderer to the viewport
      app.renderer.resize(vpRef.current.w, vpRef.current.h)

      el.appendChild(app.canvas as HTMLCanvasElement)
      app.stage.addChild(sceneContainer)

      // Sync transform every frame via ticker.
      //
      // CSS transform is: translate(tx, ty) scale(s) rotate(r)
      // with transform-origin: (vpW/2, vpH/2).
      //
      // In PixiJS we replicate this as:
      //   pivot = (0, 0)
      //   position = ( vpW/2*(1-s) + tx,  vpH/2*(1-s) + ty )
      //   scale = s
      //   rotation = r in radians
      //
      // This produces the same visual result as the CSS transform chain.
      app.ticker.add(() => {
        const s = scaleRef.current
        const vw = vpRef.current.w
        const vh = vpRef.current.h
        sceneContainer.position.set(
          vw / 2 * (1 - s) + txRef.current,
          vh / 2 * (1 - s) + tyRef.current,
        )
        sceneContainer.scale.set(s)
        sceneContainer.rotation = rotRef.current * Math.PI / 180
      })

      setCtx({ app, sceneContainer, connectionsLayer, nodesLayer, overlaysLayer })
      pixiLayers.set(connectionsLayer, nodesLayer, overlaysLayer)
    })

    return () => {
      destroyed = true
      setCtx(null)
      pixiLayers.clear()
      if (initialized) {
        app.destroy(true, { children: true })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Mount once — transform synced via refs + ticker

  // Resize renderer when viewport changes
  useEffect(() => {
    if (!ctx) return
    ctx.app.renderer.resize(vpSize.w, vpSize.h)
  }, [ctx, vpSize.w, vpSize.h])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {ctx && (
        <PixiSceneContext.Provider value={ctx}>
          {children}
        </PixiSceneContext.Provider>
      )}
    </div>
  )
}
