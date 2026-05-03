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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { SceneRenderer } from '../scene/SceneRenderer'
import { bindStoreToRenderer } from './sceneBridge'
import { PointerController } from '../viewport/PointerController'
import { WheelController } from '../viewport/WheelController'
import { KeyboardController } from '../viewport/KeyboardController'
import { useOmniStore } from '../model/store'
import { spawnGrid, spawnNested } from '../bench/spawnGrid'
import { runScenario, listScenarios, type BenchResult } from '../bench/harness'
import { applyThemeToDOM, resolvePalette } from '../theme/themes'
import { resolveBackground } from '../theme/backgrounds'
import type { ThemeMode, BackgroundConfig } from '../theme/types'
import { FpsOverlay } from './FpsOverlay'
import { LeftSidebar, DRAG_MIME_SHAPE } from '../ui/LeftSidebar'
import { RightSidebar } from '../ui/RightSidebar'
import { EditorToolbar } from '../ui/EditorToolbar'
import { ConnectionReferencePopup } from '../ui/ConnectionReferencePopup'
import { MpdDial } from '../mpd/MpdDial'
import { clientToScene, SCENE_H, SCENE_W } from '../scene/sceneConstants'
import type { NodeShape } from '../model/types'

export function OmnigramApp() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [renderer, setRenderer] = useState<SceneRenderer | null>(null)
  const cosmetics = useSyncExternalStore(
    useOmniStore.subscribe,
    () => useOmniStore.getState().model.cosmetics,
  )
  const themeMode: ThemeMode = cosmetics?.themeMode ?? 'light'
  const background = cosmetics?.background

  // Apply theme palette to documentElement CSS vars + topical body class.
  useEffect(() => {
    applyThemeToDOM(resolvePalette(themeMode))
    document.documentElement.dataset.theme = themeMode
    return () => {
      delete document.documentElement.dataset.theme
    }
  }, [themeMode])

  // Push the resolved palette into the renderer so default-coloured nodes
  // recolour with the theme. Per-node user-chosen colours are preserved.
  useEffect(() => {
    if (!renderer) return
    const p = resolvePalette(themeMode)
    const labelHex = p.nodeLabel.startsWith('#') ? p.nodeLabel : '#132949'
    const labelNum = parseInt(labelHex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
    renderer.setThemePalette({ cell: p.nodeCell, membrane: p.nodeMembrane, label: labelNum })
  }, [renderer, themeMode])

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        // Theme palette `viewportBg` is the diagram's resting backdrop. An
        // explicit `BackgroundLayer` (gradient/solid/pattern/image) renders
        // on top via the next sibling div.
        background: resolvePalette(themeMode).viewportBg,
      }}
    >
      <BackgroundLayer config={background} />
      <div
        ref={hostRef}
        style={{
          position: 'absolute',
          inset: 0,
          touchAction: 'none',
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME_SHAPE)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          const shape = e.dataTransfer.getData(DRAG_MIME_SHAPE) as NodeShape | ''
          if (!shape || !renderer) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const cam = renderer.getCamera()
          const vp = renderer.getViewport()
          const { x, y } = clientToScene(
            e.clientX - rect.left,
            e.clientY - rect.top,
            cam,
            vp,
          )
          const store = useOmniStore.getState()
          const grid = store.model.grid
          const step = grid?.snap ? Math.max(0, grid.sizePercent) : 0
          const sx = step > 0 ? Math.round(x / step) * step : x
          const sy = step > 0 ? Math.round(y / step) * step : y
          const id = store.addNode({ x: sx, y: sy, shape, label: '' })
          store.select(id)
        }}
      />
      <FpsOverlay renderer={renderer} />
      <EditorToolbar renderer={renderer} />
      <DevPanel renderer={renderer} />
      <LeftSidebar />
      <RightSidebar renderer={renderer} />
      <ConnectionReferencePopup renderer={renderer} />
      <MpdDialOverlay renderer={renderer} />
      <NodeLabelEditor renderer={renderer} hostRef={hostRef} />
    </div>
  )
}

/**
 * Diagram background layer. Sits below the canvas and renders solid /
 * gradient / pattern / image backgrounds via plain CSS — no GPU cost.
 */
function BackgroundLayer({ config }: { config: BackgroundConfig | undefined }) {
  if (!config) return null
  const style = resolveBackground(config)
  // Image backgrounds need an extra <img>-style layer for fit + opacity + blur.
  if (config.type === 'image') {
    return (
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${config.value})`,
          backgroundSize: config.fit === 'contain' ? 'contain' : config.fit === 'tile' ? 'auto' : 'cover',
          backgroundRepeat: config.fit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center center',
          opacity: config.opacity ?? 1,
          filter: config.blur ? `blur(${config.blur}px)` : undefined,
          pointerEvents: 'none',
        }}
      />
    )
  }
  return (
    <div
      aria-hidden
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...style }}
    />
  )
}

function DevPanel({ renderer }: { renderer: SceneRenderer | null }) {
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
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 9,
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
          {`${bench.scenario}  frames=${bench.frames}  fps p50=${bench.fpsP50} p95=${bench.fpsP95}  ms p50=${bench.frameMsP50} p95=${bench.frameMsP95} max=${bench.frameMsMax}`}
        </div>
      )}
    </div>
  )
}

function MpdDialOverlay({ renderer }: { renderer: SceneRenderer | null }) {
  // Re-render on rev/selection changes.
  useSyncExternalStore(
    (cb) => useOmniStore.subscribe(cb),
    () => useOmniStore.getState().rev * 65537 + useOmniStore.getState().selRev,
    () => 0,
  )
  const state = useOmniStore.getState()
  if (!renderer) return null
  // Dial appears only when exactly one node is selected and that node has
  // ≥2 MPD dimensions to choose from.
  if (state.selectedIds.size !== 1) return null
  const sourceId = state.selectedIds.values().next().value as string
  const sourceNode = state.model.nodes.get(sourceId)
  const dims = sourceNode?.mpdDimensions
  if (!sourceNode || !dims || dims.length < 2) return null
  const options = dims
    .map((id) => {
      const m = state.models.get(id)
      return m ? { id, label: m.name } : null
    })
    .filter((x): x is { id: string; label: string } => x !== null)
  if (options.length < 2) return null
  const activeIndex = Math.max(0, options.findIndex((o) => o.id === state.model.id))

  const handleSelect = (idx: number, direction: 'left' | 'right') => {
    const target = options[idx].id
    if (target === state.model.id) return
    const targetModel = state.models.get(target)
    if (!targetModel) return
    const oldNode = state.model.nodes.get(sourceId)
    const twin = targetModel.nodes.get(sourceId)
    if (!oldNode || !twin) return
    // Camera adjust so the twin lands at the source's prior screen position.
    const dx = ((oldNode.x - twin.x) / 100) * SCENE_W
    const dy = ((oldNode.y - twin.y) / 100) * SCENE_H

    renderer.beginMpdCurtain()
    const store = useOmniStore.getState()
    store.setActiveModel(target)
    const cam = store.camera
    store.setCamera({ panX: cam.panX + dx, panY: cam.panY + dy })
    renderer.playMpdCurtain(direction, 500)
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 12,
      }}
    >
      <MpdDial options={options} activeIndex={activeIndex} onSelect={handleSelect} />
    </div>
  )
}

/**
 * In-place label editor: a `<textarea>` overlay sized + positioned to match
 * the focused node's screen rect. Mounted only when `editingNodeId` is set
 * (double-click on a node). Commits on blur or Enter (without Shift);
 * cancels on Escape.
 */
function NodeLabelEditor({
  renderer,
  hostRef,
}: {
  renderer: SceneRenderer | null
  hostRef: React.RefObject<HTMLDivElement | null>
}) {
  // Subscribe to editing/rev/selection so we re-render when state changes.
  useSyncExternalStore(
    (cb) => useOmniStore.subscribe(cb),
    () => {
      const s = useOmniStore.getState()
      return s.rev * 65537 + s.selRev
    },
    () => 0,
  )
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const editingId = useOmniStore.getState().editingNodeId
  const node = editingId ? useOmniStore.getState().model.nodes.get(editingId) : null
  const [draft, setDraft] = useState('')

  // Reset draft when target changes.
  useEffect(() => {
    if (node) {
      setDraft(node.label)
      // Defer focus so the overlay is mounted first.
      requestAnimationFrame(() => {
        const el = taRef.current
        if (el) {
          el.focus()
          el.select()
        }
      })
    }
    // We only want to seed the draft when the editing target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  if (!renderer || !editingId || !node) return null

  const cam = renderer.getCamera()
  const vp = renderer.getViewport()
  const s = cam.freeScale
  const cx = vp.width / 2 + (cam.panX + (node.x / 100) * SCENE_W) * s
  const cy = vp.height / 2 + (cam.panY + (node.y / 100) * SCENE_H) * s
  const w = (node.w / 100) * SCENE_W * s
  const h = (node.h / 100) * SCENE_H * s

  const commit = () => {
    const trimmed = draft
    if (trimmed !== node.label) {
      useOmniStore.getState().updateNode(editingId, { label: trimmed })
    }
    useOmniStore.getState().setEditingNode(null)
  }
  const cancel = () => {
    useOmniStore.getState().setEditingNode(null)
  }

  // Position is relative to the host div (the renderer canvas parent).
  const hostRect = hostRef.current?.getBoundingClientRect()
  const left = (hostRect?.left ?? 0) + cx - w / 2
  const top = (hostRect?.top ?? 0) + cy - h / 2

  return (
    <textarea
      ref={taRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          commit()
        }
      }}
      style={{
        position: 'fixed',
        left,
        top,
        width: w,
        height: h,
        margin: 0,
        padding: 4,
        boxSizing: 'border-box',
        border: '2px solid #4aa3ff',
        borderRadius: 4,
        background: '#fff',
        color: '#223046',
        fontFamily: 'sans-serif',
        fontSize: Math.max(10, Math.min(28, h * 0.4)),
        textAlign: 'center',
        resize: 'none',
        zIndex: 100,
        outline: 'none',
      }}
    />
  )
}
