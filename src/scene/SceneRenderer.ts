/**
 * SceneRenderer — owns the PixiJS Application, the world container with the
 * camera transform, two layers (edges below, nodes above), and the per-frame
 * cull → diff → update loop.
 *
 * Lifecycle: `await init(host)` once, `setModel({ nodes, edges })` on every
 * store rev, `setCamera(...)` whenever pan/zoom changes (hot path; bypasses
 * React). `tick()` is registered with the Pixi ticker.
 */

import { Application, BlurFilter, Container, Graphics, RenderTexture, Sprite, Text } from 'pixi.js'
import {
  LOD_FULL,
  LOD_SIMPLE,
  SCENE_H,
  SCENE_W,
  type CameraTransform,
  type SceneAabb,
  type ViewportSize,
  visibleSceneAabb,
} from './sceneConstants'
import { Quadtree } from '../spatial/quadtree'
import type { Connection, Model, ModelNode } from '../model/types'
import { useOmniStore } from '../model/store'
import { EdgePool } from './EdgePool'
import { NodePool, type Lod } from './NodePool'
import { drawNodeShape, drawNodeShapePath, pointInShape } from './shapes'
import { shapeEdgeIntersect } from './shapeIntersect'
import { pulse01 } from './anim'
import { createInitialSnapshot, type HybridZoomSnapshot } from '../zoom/hybridZoom'
import { ParticleLayer } from '../theme/ParticleLayer'
import { estimateFlowEffectDuration, FlowRuntime } from '../flow/runtime'
import { TextGenRunner, type TextGenConfig } from '../audio/TextGenRunner'
import { TEXT_GEN_SOUND_PRESETS } from '../audio/textGenSounds'
import type { FlowEffect } from '../flow/types'
import type { CrossEffectLink } from '../model/types'

export interface ModelView {
  nodes: ReadonlyMap<string, ModelNode>
  edges: ReadonlyMap<string, Connection>
  grid?: { enabled: boolean; snap: boolean; sizePercent: number; appearance?: 'lines' | 'dots' | 'tile' }
  crossLinks?: CrossEffectLink[]
}

export interface SceneRendererStats {
  fps: number
  visibleNodes: number
  visibleEdges: number
  totalNodes: number
}

const CULL_PADDING = 5 // scene percent

export class SceneRenderer {
  private app: Application | null = null
  private world!: Container
  private edgesLayer!: Container
  private nodesLayer!: Container
  private overlayLayer!: Container
  /** Grid lines, drawn beneath edges in world coords. */
  private gridLayer!: Graphics
  /** Selection rings, drawn over `nodesLayer` and rebuilt only on dirty. */
  private selectionLayer!: Container
  /** Box-select rectangle (single Graphics). */
  private boxSelectGfx!: Graphics
  private nodePool!: NodePool
  private edgePool!: EdgePool
  private quadtree = new Quadtree()
  private model: ModelView = { nodes: new Map(), edges: new Map() }
  /** Raw user camera (free pan + free zoom). RMM scale composes on top. */
  private camera: CameraTransform = { panX: 0, panY: 0, freeScale: 1 }
  /** Effective scale = camera.freeScale * rmmSnap.cameraScale. Cached for reuse. */
  private effectiveScale = 1
  private viewport: ViewportSize = { width: 0, height: 0 }
  private selectedIds: ReadonlySet<string> = new Set()
  private selectedEdgeIds: ReadonlySet<string> = new Set()
  private selectionGfxPool: Graphics[] = []
  /**
   * Aura container painted BELOW the nodes layer so the wavey illumination
   * bleeds outward from each silhouette without overpainting the node
  * interior. Holds two sub-containers (outer + inner glow) so the wave
  * can breathe independently from the crisp ring.
   */
  private selectionAuraLayer!: Container
  private selectionAuraOuter!: Container
  private selectionAuraInner!: Container
  private selectionAuraOuterPool: Graphics[] = []
  private selectionAuraInnerPool: Graphics[] = []
  /**
   * Crisp ring container, drawn ABOVE nodes (sits on `selectionLayer`).
   * Index-aligned with the aura pools above so position-by-id is implicit.
   */
  private selectionAuraRing!: Container
  private selectionAuraRingPool: Graphics[] = []
  /**
   * Flow halo aura — also painted BELOW the nodes layer (parented to a
   * dedicated `flowAuraLayer` between particles and the edges). Wire core
   * and rings live on `flowOverlayGfx` above the nodes.
   */
  private flowAuraLayer!: Container
  private flowAuraGlow!: Container
  private flowAuraGlowBlur: BlurFilter | null = null
  /** Per-active-node aura graphics, lazily expanded. */
  private flowAuraPool: Graphics[] = []
  /** Per-active-node crisp ring graphics (no filter), pooled. */
  private flowRingPool: Graphics[] = []
  /** Wire glow Graphics (warm halo + bead trail), filtered. */
  private flowWireGlowGfx!: Graphics
  private boxSelectAabb: SceneAabb | null = null
  /** RMM inflating-frame container in SCREEN coords (not world). */
  private rmmStage!: Container
  private rmmFrame!: Graphics
  /** Holds the child-model preview, scaled with the frame. */
  private rmmContent!: Container
  /** Pooled label Texts for the child preview. */
  private rmmContentLabels: Text[] = []
  private rmmSnap: HybridZoomSnapshot = createInitialSnapshot()
  private rmmFocusedId: string | null = null
  /** Connection-draft ghost line (screen coords). */
  private connectGhost!: Graphics
  private connectGhostSource: string | null = null
  private connectGhostCursor: { x: number; y: number } | null = null

  /** Ambient particle overlay (screen coords, above world, below RMM stage). */
  private particleLayer!: ParticleLayer
  private particlePresetId: string | null = null

  /** Stage 5 flow effect runtime. Produces per-frame node overrides. */
  readonly flow = new FlowRuntime()
  /** Per (nodeId,effectId) key → currently active always-play runId. */
  private alwaysPlayRuns = new Map<string, string>()
  /**
   * Active runs spawned by the global Play action (one-shot effects). Keyed
   * by runId for O(1) cancellation. Cleared by `stopFlow()` and pruned in
   * `isFlowPlaying`.
   */
  private playRuns = new Set<string>()
  /**
   * Wire-cascade animation channel: per `kind:'flow'` edge id, when its
   * progressive stroke-reveal began and how long it lasts. Drawn on top of
   * the static edge by `drawFlowOverlay()` and pruned once expired. Empty
   * when Play is idle.
   */
  private playWires = new Map<string, { startMs: number; durMs: number }>()
  /**
   * Active-node cascade highlight channel: per visited node id, when its
   * pulse ring began and how long it lasts. Drawn around the node body by
   * `drawFlowOverlay()` and pruned once expired.
   */
  private playActiveNodes = new Map<string, { startMs: number; durMs: number }>()
  /** Overlay Graphics for the wire reveal + active-node halo. */
  private flowOverlayGfx!: Graphics
  /**
   * Camera-tracking lerp state. While the global Play cascade is active,
   * the renderer follows any node with `cameraTracked === true` whose halo
   * is currently visible (averaged when multiple). The offset eases back
   * to (0,0) when no targets are active. Per-frame factor matches legacy
   * useFlowEngine (~0.08).
   */
  private cameraTrackOffsetX = 0
  private cameraTrackOffsetY = 0
  readonly textGen = new TextGenRunner()
  /**
   * Active recording sessions by target node id. The `record` flow kind
   * spins up a `MediaRecorder` against the canvas; the `obs-record` kind
   * dials OBS WebSocket. Stop callbacks finalize the blob (download) or
   * issue OBS stop. One per kind; if a target node fires the same kind
   * concurrently we reject the second start (legacy parity).
   */
  private canvasRecordings = new Map<string, { stop: () => Promise<Blob>; cancel: () => void }>()
  private obsConnections = new Map<string, import('../recording/obsClient').ObsConnection>()
  /**
   * Ephemeral decorative spawn groups, keyed by host node id. Created by
   * the `spawn` / `spawn-circular` flow kinds; rendered as plain Pixi
   * Graphics in `ephemeralLayer` (world coords). Lifecycle:
   *   start → fade in over `fadeMs`
   *   stop  → fade out over `fadeMs` then destroy
   * Multiple groups per host stack independently (each fires on its own
   * task activation); `kind` lets the stop callback target only same-kind
   * groups.
   */
  private ephemeralSpawns = new Map<string, EphemeralSpawnGroup[]>()
  private ephemeralLayer!: Container

  /** MPD curtain: sprite painted with a snapshot of the previous scene. */
  private curtainSprite: Sprite | null = null
  private curtainMask: Graphics | null = null
  /** World mask, in screen coords. Clips new scene to swept band. */
  private curtainWorldMask: Graphics | null = null
  /** Brush-edge highlight stripe drawn on top of stage. */
  private curtainBrush: Graphics | null = null
  private curtainStartMs = 0
  private curtainDurationMs = 0
  private curtainDirection: 'left' | 'right' = 'right'
  private curtainOnDone: (() => void) | null = null

  // Reusable scratch buffers — keep hot path GC-free.
  private visibleIds: string[] = []
  private prevVisibleNodes = new Set<string>()
  private visibleNodesScratch = new Set<string>()
  private visibleEdgesScratch = new Set<string>()
  private prevVisibleEdges = new Set<string>()
  private releaseScratch: string[] = []

  // FPS sampling.
  private fps = 0
  private fpsAccumFrames = 0
  private fpsAccumTimeMs = 0

  /** Bumped externally whenever the model maps change. */
  private dirty = true
  /** Set by `destroy()`; prevents async init from resuming after teardown. */
  private disposed = false

  async init(host: HTMLElement): Promise<void> {
    if (this.disposed) return
    if (this.app) throw new Error('SceneRenderer already initialised')
    const app = new Application()
    await app.init({
      preference: 'webgl',
      resizeTo: host,
      antialias: true,
      // Transparent canvas — diagram background is rendered by a DOM layer
      // behind the host so themes/gradients/patterns show through.
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    if (this.disposed) {
      // We were torn down while awaiting; clean up the orphan and bail.
      try {
        app.destroy(true, { children: true })
      } catch {
        /* ignore */
      }
      return
    }
    this.app = app
    host.appendChild(app.canvas)
    this.world = new Container()
    this.world.eventMode = 'none'
    this.edgesLayer = new Container()
    this.edgesLayer.eventMode = 'none'
    this.gridLayer = new Graphics()
    this.gridLayer.eventMode = 'none'
    this.gridLayer.visible = false
    this.nodesLayer = new Container()
    this.nodesLayer.eventMode = 'none'
    this.selectionLayer = new Container()
    this.selectionLayer.eventMode = 'none'
    // Aura layer sits BELOW nodes so the wavey glow bleeds outward but the
    // node interior is never overpainted (matches legacy `drop-shadow` +
    // `clip-path` behaviour). Two filtered sub-containers each carry a
    // single cached BlurFilter shared across nodes.
    this.selectionAuraLayer = new Container()
    this.selectionAuraLayer.eventMode = 'none'
    this.selectionAuraOuter = new Container()
    this.selectionAuraOuter.eventMode = 'none'
    // Selection aura uses unfiltered shape-following strokes. BlurFilter
    // pads by an axis-aligned rectangle, which can show faint squared
    // corners around rounded nodes; the stroke stack below keeps the glow
    // rounded and GPU-cheap.
    this.selectionAuraOuter.filters = []
    this.selectionAuraInner = new Container()
    this.selectionAuraInner.eventMode = 'none'
    this.selectionAuraInner.filters = []
    this.selectionAuraLayer.addChild(this.selectionAuraOuter)
    this.selectionAuraLayer.addChild(this.selectionAuraInner)
    // Ring sub-container stays on `selectionLayer` (above nodes).
    this.selectionAuraRing = new Container()
    this.selectionAuraRing.eventMode = 'none'
    this.selectionLayer.addChild(this.selectionAuraRing)
    this.overlayLayer = new Container()
    this.overlayLayer.eventMode = 'none'
    this.boxSelectGfx = new Graphics()
    this.overlayLayer.addChild(this.boxSelectGfx)
    // Flow halo glow lives on its own below-nodes layer so the warm bleed
    // never overpaints node bodies. Wire core + beads + crisp ring stay on
    // `flowOverlayGfx` above the nodes for legibility.
    this.flowAuraLayer = new Container()
    this.flowAuraLayer.eventMode = 'none'
    this.flowAuraGlow = new Container()
    this.flowAuraGlow.eventMode = 'none'
    this.flowAuraGlowBlur = new BlurFilter({ strength: 14, quality: 4, kernelSize: 9 })
    this.flowWireGlowGfx = new Graphics()
    this.flowWireGlowGfx.eventMode = 'none'
    this.flowAuraGlow.addChild(this.flowWireGlowGfx)
    this.flowAuraGlow.filters = [this.flowAuraGlowBlur]
    this.flowAuraLayer.addChild(this.flowAuraGlow)
    this.flowOverlayGfx = new Graphics()
    this.flowOverlayGfx.eventMode = 'none'
    this.overlayLayer.addChild(this.flowOverlayGfx)
    this.world.addChild(this.gridLayer)
    this.world.addChild(this.edgesLayer)
    // Glow layers go BELOW nodes so they bleed outward only.
    this.world.addChild(this.selectionAuraLayer)
    this.world.addChild(this.flowAuraLayer)
    this.world.addChild(this.nodesLayer)
    this.world.addChild(this.selectionLayer)
    this.world.addChild(this.overlayLayer)
    // Ephemeral spawn layer sits above nodes so spawned decorations are
    // visible without occluding selection/box-select chrome.
    this.ephemeralLayer = new Container()
    this.ephemeralLayer.eventMode = 'none'
    this.world.addChild(this.ephemeralLayer)
    app.stage.addChild(this.world)
    // Particle overlay is parented to the WORLD so it pans/zooms with the
    // background (legacy parity — particles are part of the canvas, not the
    // viewport chrome). The container is offset by -SCENE_W/2, -SCENE_H/2
    // so particle coords (0..SCENE_W, 0..SCENE_H) land on the centred
    // virtual canvas. Sits between gridLayer and edgesLayer in z-order.
    this.particleLayer = new ParticleLayer()
    this.particleLayer.container.x = -SCENE_W / 2
    this.particleLayer.container.y = -SCENE_H / 2
    this.world.addChildAt(this.particleLayer.container, 1)
    // RMM stage + connection ghost live in screen coords ABOVE the world.
    this.rmmStage = new Container()
    this.rmmStage = new Container()
    this.rmmStage.eventMode = 'none'
    this.rmmStage.visible = false
    this.rmmFrame = new Graphics()
    this.rmmFrame.eventMode = 'none'
    this.rmmContent = new Container()
    this.rmmContent.eventMode = 'none'
    this.rmmStage.addChild(this.rmmFrame)
    this.rmmStage.addChild(this.rmmContent)
    app.stage.addChild(this.rmmStage)
    this.connectGhost = new Graphics()
    this.connectGhost.eventMode = 'none'
    this.connectGhost.visible = false
    app.stage.addChild(this.connectGhost)
    this.nodePool = new NodePool(this.nodesLayer)
    this.nodePool.onNodeFit = (id, w, h) => {
      const n = this.model.nodes.get(id) as ModelNode | undefined
      if (!n) return
      if (n.w >= w && n.h >= h) return
      ;(n as { w: number; h: number }).w = Math.max(n.w, w)
      ;(n as { w: number; h: number }).h = Math.max(n.h, h)
      this.quadtree.update(id, nodeAabb(n))
      this.dirty = true
    }
    this.edgePool = new EdgePool(this.edgesLayer)
    this.viewport = { width: app.screen.width, height: app.screen.height }
    // Particles wrap inside the virtual scene rect, not the screen viewport,
    // so they remain anchored to the background while the camera moves.
    this.particleLayer.setViewport(SCENE_W, SCENE_H)
    this.applyCameraTransform()
    // Bridge text-generator side-effects from the FlowRuntime to the local
    // TextGenRunner so the `'text-generator'` flow effect kind drives the
    // same reveal pipeline that the legacy stand-alone control used.
    this.flow.onTextGen = (targetId, params) => {
      const node = this.model.nodes.get(targetId)
      if (!node) return
      const config: TextGenConfig = {
        text: node.label ?? '',
        charsPerSec: Math.max(1, params.charsPerSec ?? 24),
        sound: TEXT_GEN_SOUND_PRESETS[Math.max(0, Math.round(params.soundPreset ?? 0))]?.id ?? 'none',
        loop: (params.loop ?? 0) !== 0,
        endHoldMs: Math.max(0, params.endHoldMs ?? 0),
        startIndex: Math.max(0, params.startIndex ?? 0),
        endIndex: params.endIndex ?? -1,
        degenerationMs: Math.max(0, params.degenerationMs ?? 0),
      }
      this.textGen.start(node, config, performance.now())
      this.dirty = true
    }
    this.flow.onTextGenStop = (targetId) => {
      const node = this.model.nodes.get(targetId)
      if (!node) return
      this.textGen.stop(node)
      this.dirty = true
    }
    // Bridge `record` flow kind to MediaRecorder. `targetId` is the node
    // that fired the effect; the canvas itself is the capture surface.
    this.flow.onRecord = async (targetId, params) => {
      if (this.canvasRecordings.has(targetId)) return
      const canvas = this.getCanvas()
      if (!canvas) return
      try {
        const { startCanvasRecording, isRecordingSupported } = await import('../recording/canvasRecorder')
        if (!isRecordingSupported()) return
        const fps = Math.max(1, params.fps ?? 30)
        this.canvasRecordings.set(targetId, startCanvasRecording(canvas, fps))
      } catch (err) {
        console.warn('[SceneRenderer] canvas record start failed', err)
      }
    }
    this.flow.onRecordStop = async (targetId) => {
      const rec = this.canvasRecordings.get(targetId)
      if (!rec) return
      this.canvasRecordings.delete(targetId)
      try {
        const blob = await rec.stop()
        const { downloadBlob } = await import('../recording/canvasRecorder')
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
        downloadBlob(blob, `omnigram-${targetId}-${Date.now()}.${ext}`)
      } catch (err) {
        console.warn('[SceneRenderer] canvas record stop failed', err)
      }
    }
    // Bridge `obs-record` to the OBS WebSocket. Connection details come from
    // localStorage (`omnigram-obs`) so the user is prompted at most once.
    this.flow.onObsRecord = async (targetId) => {
      if (this.obsConnections.has(targetId)) return
      try {
        const { connectObs, obsStartRecord } = await import('../recording/obsClient')
        const settings = readObsSettings()
        if (!settings) return
        const conn = await connectObs(settings.host, settings.port, settings.password)
        await obsStartRecord(conn)
        this.obsConnections.set(targetId, conn)
      } catch (err) {
        console.warn('[SceneRenderer] OBS record start failed', err)
      }
    }
    this.flow.onObsRecordStop = async (targetId) => {
      const conn = this.obsConnections.get(targetId)
      if (!conn) return
      this.obsConnections.delete(targetId)
      try {
        const { obsStopRecord } = await import('../recording/obsClient')
        await obsStopRecord(conn)
      } catch (err) {
        console.warn('[SceneRenderer] OBS record stop failed', err)
      } finally {
        try { conn.close() } catch { /* ignore */ }
      }
    }
    // Bridge navigation side-effects. RMM handoff steps the dial all the
    // way in (firing the host swap when ready); RMM return walks all the
    // way out (popping the zoom stack). MPD handoff cycles the host
    // node's `mpdDimensions` by `direction` (+1 next, -1 prev) and runs
    // the curtain. Each fires once per task activation.
    this.flow.onHandoffRmm = (targetId) => {
      const store = useOmniStore.getState()
      // Seed selection on the host so rmmZoomStep('in') picks it as focus.
      if (!store.focusedNodeId) store.select(targetId)
      // Walk the dial in until handoff fires (the store no-ops once the
      // child is unavailable or the swap completes).
      for (let i = 0; i < 32; i++) {
        const before = useOmniStore.getState().model.id
        useOmniStore.getState().rmmZoomStep('in')
        const after = useOmniStore.getState()
        if (after.model.id !== before) return // handoff completed
        if (after.zoom.progress >= 0.999 && before === after.model.id) return
      }
    }
    this.flow.onReturnRmm = () => {
      const store = useOmniStore.getState()
      if (store.zoomStack.length === 0 && store.zoom.progress < 0.001) return
      for (let i = 0; i < 32; i++) {
        const before = useOmniStore.getState()
        useOmniStore.getState().rmmZoomStep('out')
        const after = useOmniStore.getState()
        if (after.zoomStack.length === 0 && after.zoom.progress < 0.001) return
        if (after === before) return
      }
    }
    this.flow.onHandoffMpd = (targetId, params) => {
      const store = useOmniStore.getState()
      const node = store.model.nodes.get(targetId)
      const dims = node?.mpdDimensions
      if (!node || !dims || dims.length < 2) return
      const curIdx = dims.indexOf(store.model.id)
      const dir = (params.direction ?? 1) >= 0 ? 1 : -1
      const nextIdx = ((curIdx < 0 ? 0 : curIdx) + dir + dims.length) % dims.length
      const target = dims[nextIdx]
      if (target === store.model.id) return
      const targetModel = store.models.get(target)
      const twin = targetModel?.nodes.get(targetId)
      if (!targetModel || !twin) return
      const dx = ((node.x - twin.x) / 100) * SCENE_W
      const dy = ((node.y - twin.y) / 100) * SCENE_H
      this.beginMpdCurtain()
      store.setActiveModel(target)
      const cam = useOmniStore.getState().camera
      useOmniStore.getState().setCamera({ panX: cam.panX + dx, panY: cam.panY + dy })
      const direction: 'left' | 'right' = dir > 0 ? 'right' : 'left'
      this.playMpdCurtain(direction, Math.max(50, params.ms ?? 500))
    }
    // Bridge spawn / spawn-circular ephemeral decorations.
    this.flow.onSpawn = (targetId, params) => {
      this.startEphemeralSpawn(targetId, params, 'random')
    }
    this.flow.onSpawnStop = (targetId) => {
      this.beginEphemeralFadeOut(targetId, 'spawn')
    }
    this.flow.onSpawnCircular = (targetId, params) => {
      this.startEphemeralSpawn(targetId, params, 'circular')
    }
    this.flow.onSpawnCircularStop = (targetId) => {
      this.beginEphemeralFadeOut(targetId, 'spawn-circular')
    }
    app.ticker.add(this.onTick)
  }

  destroy(): void {
    this.disposed = true
    if (!this.app) return
    try {
      this.app.ticker?.remove(this.onTick)
    } catch {
      /* ticker may not exist if init failed */
    }
    this.cancelMpdCurtain()
    this.nodePool?.destroy()
    this.edgePool?.destroy()
    this.particleLayer?.destroy()
    let canvas: HTMLCanvasElement | null = null
    try {
      canvas = this.app.canvas
    } catch {
      /* renderer not initialised (happy-dom path) */
    }
    try {
      this.app.destroy(true, { children: true })
    } catch {
      /* destroy may fail on a half-initialised app */
    }
    // Pixi v8 doesn't always remove the canvas from its parent — do it ourselves.
    if (canvas && canvas.parentElement) {
      canvas.parentElement.removeChild(canvas)
    }
    this.app = null
    this.quadtree.clear()
  }

  /** Replace model view. Triggers full quadtree rebuild + re-cull. */
  setModel(model: ModelView): void {
    this.model = model
    this.rebuildQuadtree()
    this.syncAlwaysPlayEffects(model.nodes)
    this.dirty = true
  }

  /** Bump after individual store changes when full setModel isn't needed. */
  invalidate(): void {
    this.dirty = true
  }

  /**
   * Hot-path drag write. Mutates the live ModelNode in place, updates the
   * quadtree entry, and marks the renderer dirty — bypassing the store and
   * its subscribers entirely. The caller is responsible for committing to
   * the store on gesture end (e.g. via `useOmniStore.commitDrag`).
   */
  moveNodeDirect(id: string, x: number, y: number): void {
    const node = this.model.nodes.get(id) as ModelNode | undefined
    if (!node) return
    if (node.x === x && node.y === y) return
    // In-place mutation is intentional: the store's Map identity is preserved
    // (we only swap top-level model identity on transactions), so reading the
    // same node via the store reflects the live drag state.
    ;(node as { x: number; y: number }).x = x
    ;(node as { x: number; y: number }).y = y
    this.quadtree.update(id, nodeAabb(node))
    this.dirty = true
  }

  /** Replace the visualised selection set. Cheap — only re-draws on dirty. */
  setSelection(ids: ReadonlySet<string>): void {
    this.selectedIds = ids
    this.dirty = true
  }

  /** Replace the visualised edge selection set. */
  setEdgeSelection(ids: ReadonlySet<string>): void {
    this.selectedEdgeIds = ids
    this.dirty = true
  }

  /** Set or clear the active particle preset (id from `PARTICLE_PRESETS`). */
  setParticles(presetId: string | null): void {
    if (this.particlePresetId === presetId) return
    this.particlePresetId = presetId
    if (!this.particleLayer) return
    this.particleLayer.setPreset(presetId)
  }

  /**
   * Push the active theme palette to the node pool so default-coloured
   * nodes adopt the theme. Per-node user-chosen colours stay verbatim.
   * Cheap (O(visible nodes)). Called by the bridge whenever `themeMode`
   * changes.
   */
  setThemePalette(theme: import('./NodePool').ThemeColors | null): void {
    this.nodePool?.setThemePalette(theme)
    this.dirty = true
  }

  /** The Pixi-owned canvas (for capture / screenshot). */
  getCanvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null
  }

  /**
   * Start a flow effect against a target node. Returns a runId (or null).
   *
   * Tier 3 I parity: also fires the effect on every linked peer of the
   * target node so previewing an effect from the inspector animates all
   * paired nodes simultaneously. Cross-links (`model.crossLinks`) are not
   * walked here — they apply only to the global Play cascade where we
   * have a deterministic schedule.
   */
  playFlowEffect(targetNodeId: string, effect: FlowEffect): string | null {
    const startedAt = performance.now()
    const runId = this.flow.start(targetNodeId, effect, startedAt)
    const node = this.model.nodes.get(targetNodeId)
    for (const peerId of node?.linkedNodeIds ?? []) {
      // Only fire on the peer if it doesn't already host this effect by id;
      // otherwise the global Play would double-fire when both ends animate.
      const peer = this.model.nodes.get(peerId)
      if (!peer) continue
      const owns = (peer.flowEffects ?? []).some((e) => e.id === effect.id)
      if (owns) continue
      this.flow.start(peerId, effect, startedAt)
    }
    return runId
  }

  /**
   * Global Play: walk the diagram from `rootNodeId` along `kind:'flow'`
   * connections, triggering each visited node's *one-shot* effects (those
   * with `alwaysPlay !== true`). Always-play loops are left alone since
   * they are already running. Returns the number of runs started.
   *
   * Pacing: each node's arrival time = max over incoming flow edges of
   * (parent.arriveAt + WIRE_MS). This matches the wire-reveal animation
   * (the downstream node only "lights up" once the wire from its slowest
   * parent has fully traversed) and handles diamond DAGs correctly. The
   * legacy fixed `depth * staggerMs` schedule fired downstream effects
   * before upstream wires finished — see plan.md item J.
   */
  playFlowFromNode(rootNodeId: string): number {
    const root = this.model.nodes.get(rootNodeId)
    if (!root) return 0
    // Build flow-only adjacency from the current edge map (kind === 'flow').
    // Track edge ids as well so the wire-reveal animation can be keyed off
    // the actual connection that was traversed.
    const adj = new Map<string, { to: string; edgeId: string }[]>()
    for (const e of this.model.edges.values()) {
      if (e.kind !== 'flow') continue
      let list = adj.get(e.from)
      if (!list) { list = []; adj.set(e.from, list) }
      list.push({ to: e.to, edgeId: e.id })
    }
    let started = 0
    const now = performance.now()
    // Wire reveal duration ports the legacy default (600 ms per hop).
    const WIRE_MS = 600
    // Node highlight duration: lingers past the next hop's departure.
    const NODE_HALO_MS = Math.max(WIRE_MS * 1.5, 800)

    // 1. Compute arrival[node] via repeated relaxation. For acyclic graphs
    //    this converges in <= depth iterations; we cap at nodes.size to
    //    bail out cleanly on cycles (back-edges are dropped at first
    //    relaxation since the parent's arrival never improves the child).
    const arrival = new Map<string, number>()
    arrival.set(rootNodeId, now)
    const maxIter = Math.max(1, this.model.nodes.size)
    let changed = true
    let iter = 0
    while (changed && iter < maxIter) {
      changed = false
      iter++
      for (const [from, outs] of adj) {
        const fromArr = arrival.get(from)
        if (fromArr === undefined) continue
        for (const out of outs) {
          const candidate = fromArr + this.oneShotFlowDuration(from) + WIRE_MS
          const existing = arrival.get(out.to)
          if (existing === undefined || candidate > existing) {
            arrival.set(out.to, candidate)
            changed = true
          }
        }
      }
    }

    // 2. For every reachable node, schedule the halo + start its one-shot
    //    effects at the computed arrival time. The runtime treats a future
    //    `startedAt` as a deferred start (elapsed < 0 → no contribution
    //    until the clock catches up).
    //
    //    Linked-peer parity (Tier 3 I): when a node fires, every node in
    //    its `linkedNodeIds` glows in lock-step. We schedule the same
    //    halo + effect runs on the peer at the same `arriveAt` so the
    //    pair is visually inseparable. Wires are NOT mirrored — only the
    //    DAG topology drives wire reveal.
    //
    //    Cross-links (`model.crossLinks`): when a host A fires an effect
    //    with id E1, any cross-link `{from:{A,E1}, to:{B,E2}}` triggers
    //    B's effect E2 at the same arriveAt. This lets users compose
    //    multi-host effect graphs from the editor.
    const crossIndex = new Map<string, Array<{ nodeId: string; effectId: string }>>()
    for (const link of this.model.crossLinks ?? []) {
      const key = `${link.from.nodeId}:${link.from.effectId}`
      let list = crossIndex.get(key)
      if (!list) { list = []; crossIndex.set(key, list) }
      list.push(link.to)
    }
    const fireOnce = (nodeId: string, arriveAt: number, depth = 0) => {
      // Depth-cap guards against pathological cross-link cycles (A.E1 →
      // B.E2 → A.E1). The runtime would also drop duplicate runs but the
      // wasted scheduling is avoided here.
      if (depth > 8) return
      const node = this.model.nodes.get(nodeId)
      if (!node) return
      const nodeDuration = this.oneShotFlowDuration(nodeId)
      this.playActiveNodes.set(nodeId, { startMs: arriveAt, durMs: Math.max(NODE_HALO_MS, nodeDuration + 250) })
      for (const eff of node.flowEffects ?? []) {
        if (eff.alwaysPlay) continue
        const runId = this.flow.start(nodeId, eff, arriveAt)
        if (runId) { this.playRuns.add(runId); started++ }
        // Cross-link fan-out: schedule paired effects on partner hosts.
        const targets = crossIndex.get(`${nodeId}:${eff.id}`)
        if (targets) {
          for (const t of targets) {
            const peer = this.model.nodes.get(t.nodeId)
            if (!peer) continue
            const peerEff = (peer.flowEffects ?? []).find((e) => e.id === t.effectId)
            if (!peerEff || peerEff.alwaysPlay) continue
            const peerDuration = this.oneShotFlowDuration(t.nodeId)
            this.playActiveNodes.set(t.nodeId, { startMs: arriveAt, durMs: Math.max(NODE_HALO_MS, peerDuration + 250) })
            const peerRunId = this.flow.start(t.nodeId, peerEff, arriveAt)
            if (peerRunId) { this.playRuns.add(peerRunId); started++ }
          }
        }
      }
      // Linked-peer fan-out (whole-effect mirror).
      for (const peerId of node.linkedNodeIds ?? []) {
        if (arrival.has(peerId)) continue // already scheduled by the DAG walk
        if (this.playActiveNodes.has(peerId)) continue // already mirrored
        fireOnce(peerId, arriveAt, depth + 1)
      }
    }
    for (const [id, arriveAt] of arrival) {
      fireOnce(id, arriveAt)
    }

    // 3. Schedule wire reveals at the parent's arrival (wire fires as the
    //    parent finishes lighting up, traverses to the child).
    for (const [from, outs] of adj) {
      const fromArr = arrival.get(from)
      if (fromArr === undefined) continue
      for (const out of outs) {
        this.playWires.set(out.edgeId, { startMs: fromArr + this.oneShotFlowDuration(from), durMs: WIRE_MS })
      }
    }

    // Force a redraw next tick so the overlay appears even when no effects
    // attached produced any node-override changes.
    this.dirty = true
    return started
  }

  private oneShotFlowDuration(nodeId: string): number {
    const node = this.model.nodes.get(nodeId)
    if (!node) return 0
    let duration = 0
    for (const eff of node.flowEffects ?? []) {
      if (eff.alwaysPlay) continue
      duration = Math.max(duration, estimateFlowEffectDuration(eff))
    }
    return duration
  }

  /** Cancel every run started by `playFlowFromNode` and clear the cascade. */
  stopFlow(): void {
    for (const id of this.playRuns) this.flow.cancel(id)
    this.playRuns.clear()
    this.playWires.clear()
    this.playActiveNodes.clear()
    this.flowOverlayGfx?.clear()
    this.dirty = true
  }

  /**
   * True while at least one Play-initiated run, wire reveal, or node halo
   * is still active. Always-play loops are excluded so the toolbar Stop
   * button only toggles cascade state.
   */
  get isFlowPlaying(): boolean {
    // Prune drained runs/wires/halos so the next read reflects reality.
    for (const id of [...this.playRuns]) {
      if (!this.flow.isActive(id)) this.playRuns.delete(id)
    }
    const now = performance.now()
    for (const [id, w] of this.playWires) {
      if (now > w.startMs + w.durMs) this.playWires.delete(id)
    }
    for (const [id, h] of this.playActiveNodes) {
      if (now > h.startMs + h.durMs) this.playActiveNodes.delete(id)
    }
    return this.playRuns.size > 0 || this.playWires.size > 0 || this.playActiveNodes.size > 0
  }

  /** Begin a text-generator on `nodeId`. Restores original label on stop. */
  startTextGen(nodeId: string, config: TextGenConfig): void {
    const node = this.model.nodes.get(nodeId)
    if (!node) return
    this.textGen.start(node, config, performance.now())
    this.dirty = true
  }

  /** Stop the active text-generator (if any) on `nodeId`. */
  stopTextGen(nodeId: string): void {
    const node = this.model.nodes.get(nodeId)
    if (!node) return
    this.textGen.stop(node)
    this.dirty = true
  }

  /**
   * Reconcile always-play flow effects with the current model. For each
   * `ModelNode.flowEffects` entry with `alwaysPlay`, ensure exactly one run
   * is active; drop runs whose effect was removed or whose owning node is
   * gone. One-shot effects are never auto-started.
   */
  syncAlwaysPlayEffects(nodes: ReadonlyMap<string, ModelNode>): void {
    const now = performance.now()
    const seen = new Set<string>()
    for (const n of nodes.values()) {
      const effects = n.flowEffects
      if (!effects) continue
      for (const e of effects) {
        if (!e.alwaysPlay) continue
        const key = `${n.id}::${e.id}`
        seen.add(key)
        if (this.alwaysPlayRuns.has(key)) continue
        const runId = this.flow.start(n.id, e, now)
        if (runId) this.alwaysPlayRuns.set(key, runId)
      }
    }
    for (const [key, runId] of [...this.alwaysPlayRuns]) {
      if (!seen.has(key)) {
        this.flow.cancel(runId)
        this.alwaysPlayRuns.delete(key)
      }
    }
  }

  /**
   * Set the in-progress box-select rectangle (scene-percent AABB) or clear
   * it. The renderer draws a translucent overlay.
   */
  setBoxSelect(aabb: SceneAabb | null): void {
    this.boxSelectAabb = aabb
    this.dirty = true
  }

  /**
   * Set the active RMM zoom snapshot and the focused node id (the node that
   * is being inflated). The renderer draws an inflating frame around the
   * focused node and a simplified preview of its child model inside.
   */
  setRmm(snap: HybridZoomSnapshot, focusedNodeId: string | null): void {
    this.rmmSnap = snap
    this.rmmFocusedId = focusedNodeId
    this.applyCameraTransform()
    this.dirty = true
  }

  /** Query node ids whose AABB intersects `aabb`. Reuses caller-supplied buffer. */
  queryAabb(aabb: SceneAabb, out: string[] = []): string[] {
    return this.quadtree.query(aabb, out)
  }

  /** Hot path: pan/zoom directly. Does NOT touch the store. Stores RAW camera. */
  setCamera(c: CameraTransform): void {
    this.camera = c
    this.applyCameraTransform()
    this.dirty = true
  }

  /**
   * Returns the EFFECTIVE composed camera (raw freeScale × RMM cameraScale).
   * Use for scene↔client coordinate math (e.g. PointerController) so picking
   * stays correct mid-RMM-zoom.
   */
  getCamera(): CameraTransform {
    return {
      panX: this.camera.panX,
      panY: this.camera.panY,
      freeScale: this.effectiveScale,
    }
  }

  /** The raw user camera, before RMM scale composition. Used by wheel handler. */
  getRawCamera(): CameraTransform {
    return this.camera
  }

  getViewport(): ViewportSize {
    return this.viewport
  }

  getStats(): SceneRendererStats {
    return {
      fps: this.fps,
      visibleNodes: this.nodePool.activeCount,
      visibleEdges: this.edgePool.activeCount,
      totalNodes: this.model.nodes.size,
    }
  }

  /** Hit-test by scene point; topmost match wins. */
  pickNode(sceneX: number, sceneY: number): string | null {
    const hits: string[] = []
    this.quadtree.pick(sceneX, sceneY, hits)
    if (hits.length === 0) return null
    // Walk hits in render order (last acquired = topmost) and apply a
    // shape-precise narrow-phase test. The quadtree only filters by AABB,
    // which is too generous for diamond/triangle/oval/hexagon.
    let best: string | null = null
    for (const id of hits) {
      const n = this.model.nodes.get(id)
      if (!n) continue
      const localX = sceneX - n.x
      const localY = sceneY - n.y
      // pointInShape works in any consistent unit system (it's all ratios),
      // so passing scene-percent local coords with scene-percent w/h is fine.
      if (pointInShape(n.shape, localX, localY, n.w, n.h)) best = id
    }
    return best
  }

  /**
   * Hit-test edges by scene point. Returns the closest edge whose centre
   * line passes within `tolerancePercent` (scene-percent) of the point, or
   * null if none. Tolerance scales with the inverse of the effective scale
   * so a fixed pixel hitbox feels consistent at any zoom.
   */
  pickEdge(sceneX: number, sceneY: number): string | null {
    // ~6 screen-px tolerance, in scene-percent units.
    const tolPx = 6 / Math.max(this.effectiveScale, 0.01)
    // Convert tol from screen-pixels to scene-percent on the X axis. Since
    // SCENE_W maps to ~SCENE_W scene-px, the conversion factor is
    // (100 / SCENE_W).
    const tol = (tolPx * 100) / SCENE_W
    let best: string | null = null
    let bestDist = tol
    for (const e of this.model.edges.values()) {
      const a = this.model.nodes.get(e.from)
      const b = this.model.nodes.get(e.to)
      if (!a || !b) continue
      const d = pointSegmentDistance(sceneX, sceneY, a.x, a.y, b.x, b.y)
      if (d < bestDist) {
        bestDist = d
        best = e.id
      }
    }
    return best
  }

  private visualNode(node: ModelNode): ModelNode {
    const override = this.flow.getOverride(node.id)
    if (!override) return node
    const dx = override.dx ?? 0
    const dy = override.dy ?? 0
    const scale = override.scaleMul ?? 1
    if (dx === 0 && dy === 0 && scale === 1) return node
    return {
      ...node,
      x: node.x + dx,
      y: node.y + dy,
      w: node.w * scale,
      h: node.h * scale,
    }
  }

  // ---- internals ----------------------------------------------------------

  private onTick = (ticker: { deltaMS: number }): void => {
    if (!this.app) return
    // Resize tracking: Pixi's resizeTo handles canvas; we mirror viewport size.
    if (
      this.viewport.width !== this.app.screen.width ||
      this.viewport.height !== this.app.screen.height
    ) {
      this.viewport = { width: this.app.screen.width, height: this.app.screen.height }
      // Particle wrap region stays anchored to the virtual scene; do not
      // resync to the screen viewport on resize.
      this.dirty = true
    }
    if (this.dirty) {
      this.cullAndDraw()
      this.dirty = false
    }
    // Flow effects: tick the runtime + force redraw while any run is active.
    // The runtime writes overrides; nodePool.update reads them in the draw pass.
    if (this.flow.hasActiveRuns) {
      this.flow.tick(performance.now())
      // Camera-effect overrides: re-apply the world transform with the
      // runtime's additive camera deltas before the draw so picking and
      // visible-AABB queries stay consistent.
      this.applyCameraTransform()
      this.cullAndDraw()
    }
    // Flow Play cascade overlay: wire reveal + active-node halo. Independent
    // of the FlowRuntime — these are pure visual indicators driven by the
    // BFS schedule baked into `playWires` / `playActiveNodes`.
    if (this.playWires.size > 0 || this.playActiveNodes.size > 0) {
      this.drawFlowOverlay(performance.now())
    } else if (this.flowOverlayGfx && (this.flowOverlayGfx as { geometry?: unknown }).geometry) {
      // Ensure the overlay is cleared once the cascade ends.
      this.flowOverlayGfx.clear()
    }
    // Camera-tracking lerp: keep ticking while either an active cameraTracked
    // halo / wire reveal exists or the offset hasn't fully eased back to zero.
    if (
      this.playActiveNodes.size > 0 ||
      this.playWires.size > 0 ||
      this.cameraTrackOffsetX !== 0 ||
      this.cameraTrackOffsetY !== 0
    ) {
      // applyCameraTransform handles the lerp + writes to world.x/y.
      this.applyCameraTransform()
    }
    // Text-generator: progressively reveals labels in-place. When characters
    // advance we mark dirty and redraw so the new label is baked into Pixi.
    if (this.textGen.hasActiveRuns) {
      const changed = this.textGen.tick(this.model.nodes, performance.now())
      if (changed) this.cullAndDraw()
    }
    // MPD curtain animates each frame; runs only when active.
    if (this.curtainDurationMs > 0) this.tickMpdCurtain()
    // Ephemeral spawn fade in/out animation.
    if (this.ephemeralSpawns.size > 0) this.tickEphemeralSpawns()
    // Particle simulation (no-op when no preset is set).
    if (this.particlePresetId) {
      // Convert deltaMS to "frames" (1.0 = 16.67 ms) so legacy preset tuning
      // remains accurate at any refresh rate.
      this.particleLayer.tick(ticker.deltaMS / 16.667)
    }
    // Selection breathing animation: the amber aura waves softly below the
    // node while the blue membrane frame stays sharp above it.
    if (this.selectedIds.size > 0) {
      const p = pulse01(performance.now(), 1500)
      this.selectionAuraOuter.alpha = 0.72 + 0.22 * p
      this.selectionAuraInner.alpha = 0.68 + 0.2 * p
      this.selectionAuraRing.alpha = 0.96
      // Subtle outward breath — 3% on outer, 1.5% on inner. For multiple
      // selections, keep scale fixed and let alpha carry the wave so each
      // node remains accurately framed.
      if (this.selectedIds.size === 1) {
        const idIter = this.selectedIds.values().next()
        const node = idIter.value ? this.model.nodes.get(idIter.value) : null
        if (node) {
          const visual = this.visualNode(node)
          const cx = (visual.x / 100) * SCENE_W
          const cy = (visual.y / 100) * SCENE_H
          const k = 1 + 0.03 * p
          this.selectionAuraOuter.pivot.set(cx, cy)
          this.selectionAuraOuter.position.set(cx, cy)
          this.selectionAuraOuter.scale.set(k)
          const k2 = 1 + 0.015 * p
          this.selectionAuraInner.pivot.set(cx, cy)
          this.selectionAuraInner.position.set(cx, cy)
          this.selectionAuraInner.scale.set(k2)
        }
      } else {
        // Reset transforms when multi-selected so positions stay accurate.
        this.selectionAuraOuter.pivot.set(0, 0)
        this.selectionAuraOuter.position.set(0, 0)
        this.selectionAuraOuter.scale.set(1)
        this.selectionAuraInner.pivot.set(0, 0)
        this.selectionAuraInner.position.set(0, 0)
        this.selectionAuraInner.scale.set(1)
      }
    } else {
      if (this.selectionAuraOuter.alpha !== 0) this.selectionAuraOuter.alpha = 0
      if (this.selectionAuraInner.alpha !== 0) this.selectionAuraInner.alpha = 0
      if (this.selectionAuraRing.alpha !== 0) this.selectionAuraRing.alpha = 0
    }
    this.fpsAccumFrames++
    this.fpsAccumTimeMs += ticker.deltaMS
    if (this.fpsAccumTimeMs >= 500) {
      this.fps = Math.round((this.fpsAccumFrames * 1000) / this.fpsAccumTimeMs)
      this.fpsAccumFrames = 0
      this.fpsAccumTimeMs = 0
    }
  }

  private applyCameraTransform(): void {
    if (!this.app) return
    // Pull any active flow camera override (additive deltas on user camera).
    const camOv = this.flow.getCameraOverride()
    const dPanX = camOv?.dPanX ?? 0
    const dPanY = camOv?.dPanY ?? 0
    const camScaleMul = camOv?.scaleMul ?? 1
    const screenShakeX = camOv?.screenShakeX ?? 0
    const screenShakeY = camOv?.screenShakeY ?? 0
    // Camera-tracked-node compensation: ease the world toward placing any
    // active cameraTracked node at viewport centre. Computed per call so
    // node motion (drag, flow override) is followed live.
    this.tickCameraTracking()
    // Effective scale composes user free-zoom with RMM cameraScale and any
    // flow camera scale override.
    this.effectiveScale = this.camera.freeScale * this.rmmSnap.cameraScale * camScaleMul
    // Scene coords are signed percent around (0,0) = viewport center.
    // World children draw at scene-pixel positions (scene% / 100 * SCENE_W).
    this.world.scale.set(this.effectiveScale)
    this.world.x = this.viewport.width / 2 + (this.camera.panX + dPanX + this.cameraTrackOffsetX) * this.effectiveScale + screenShakeX
    this.world.y = this.viewport.height / 2 + (this.camera.panY + dPanY + this.cameraTrackOffsetY) * this.effectiveScale + screenShakeY
  }

  /**
   * Update the cameraTrackOffset by lerping toward the desired value.
   *
   * Desired offset = position of the *most recently activated* cameraTracked
   * node ("top of the flow") whose Play-halo is currently visible. Tracking
   * a single leading node instead of the centroid avoids the jump that
   * happens when a new node activates (the centroid would shift abruptly
   * by half the inter-node distance). With no active tracked targets the
   * offset eases back to (0, 0).
   */
  private tickCameraTracking(): void {
    let targetX = 0
    let targetY = 0
    // Two leader candidates: the most-recently activated cameraTracked
    // node, AND the most-recently started cameraTracked wire reveal. The
    // newest startMs wins, so the camera smoothly slides along a tracked
    // wire from one tracked node to the next.
    type Leader = { startMs: number; x: number; y: number }
    let leader: Leader | null = null
    const now = performance.now()
    if (this.playActiveNodes.size > 0) {
      for (const [id, halo] of this.playActiveNodes) {
        if (now < halo.startMs) continue
        const node = this.model.nodes.get(id)
        if (!node || !node.cameraTracked) continue
        if (!leader || halo.startMs > leader.startMs) {
          const visual = this.visualNode(node)
          const cxPx = ((visual.x + visual.w / 2) / 100) * SCENE_W
          const cyPx = ((visual.y + visual.h / 2) / 100) * SCENE_H
          leader = { startMs: halo.startMs, x: cxPx, y: cyPx }
        }
      }
    }
    if (this.playWires.size > 0) {
      for (const [edgeId, w] of this.playWires) {
        if (now < w.startMs || now > w.startMs + w.durMs) continue
        const edge = this.model.edges.get(edgeId)
        if (!edge || !edge.cameraTracked) continue
        const from = this.model.nodes.get(edge.from)
        const to = this.model.nodes.get(edge.to)
        if (!from || !to) continue
        const fromVisual = this.visualNode(from)
        const toVisual = this.visualNode(to)
        // Linear interpolation of the head bead along the wire matches the
        // visual on `flowOverlayGfx`. Coordinates use node center (no w/2)
        // so the camera lands on the same point as the bead.
        const t = Math.min(1, Math.max(0, (now - w.startMs) / w.durMs))
        const fxC = (fromVisual.x / 100) * SCENE_W
        const fyC = (fromVisual.y / 100) * SCENE_H
        const txC = (toVisual.x / 100) * SCENE_W
        const tyC = (toVisual.y / 100) * SCENE_H
        const hx = fxC + (txC - fxC) * t
        const hy = fyC + (tyC - fyC) * t
        if (!leader || w.startMs > leader.startMs) {
          leader = { startMs: w.startMs, x: hx, y: hy }
        }
      }
    }
    if (leader) {
      targetX = -leader.x - this.camera.panX
      targetY = -leader.y - this.camera.panY
    }
    // Lerp factor 0.08 matches legacy flowCameraRef tuning. Small enough to
    // avoid jitter on sub-pixel node moves, large enough to track a 60 FPS
    // flow override without visible lag.
    const k = 0.08
    this.cameraTrackOffsetX += (targetX - this.cameraTrackOffsetX) * k
    this.cameraTrackOffsetY += (targetY - this.cameraTrackOffsetY) * k
    // Snap to zero when very close to avoid lingering sub-pixel offsets.
    if (!leader && Math.abs(this.cameraTrackOffsetX) < 0.05) this.cameraTrackOffsetX = 0
    if (!leader && Math.abs(this.cameraTrackOffsetY) < 0.05) this.cameraTrackOffsetY = 0
  }

  /**
   * Reconcile the renderer with `model` Maps that may have been mutated in
   * place since last frame. Cheap: skips the quadtree rebuild and only
   * touches entries whose AABB actually changed (or that were added/removed).
   * Used by the bridge for store mutations whose Map identity is unchanged
   * (drag commits, single-entity edits, undo/redo).
   */
  syncIncremental(
    nodes: Map<string, ModelNode>,
    edges: Map<string, Connection>,
    grid?: ModelView['grid'],
  ): void {
    this.model = { nodes, edges, grid }
    // Add or update entries for nodes currently in the model.
    for (const n of nodes.values()) {
      // quadtree.update is no-op if AABB unchanged; otherwise re-inserts.
      this.quadtree.update(n.id, nodeAabb(n))
    }
    // Drop quadtree (and pool) entries for nodes that no longer exist.
    // Collect first to avoid iterator invalidation during remove.
    this.releaseScratch.length = 0
    for (const id of this.quadtree.ids()) {
      if (!nodes.has(id)) this.releaseScratch.push(id)
    }
    for (let i = 0; i < this.releaseScratch.length; i++) {
      const id = this.releaseScratch[i]
      this.quadtree.remove(id)
      this.nodePool.release(id)
      this.prevVisibleNodes.delete(id)
    }
    this.syncAlwaysPlayEffects(nodes)
    this.dirty = true
  }

  private rebuildQuadtree(): void {
    this.quadtree.clear()
    for (const n of this.model.nodes.values()) {
      this.quadtree.insert(n.id, nodeAabb(n))
    }
  }

  private cullAndDraw(): void {
    if (!this.app) return
    const visibleAabb: SceneAabb = visibleSceneAabb(this.camera, this.viewport, CULL_PADDING)
    this.quadtree.query(visibleAabb, this.visibleIds)

    // Build the new visible-set into a reused Set (cleared, not reallocated).
    const visibleSet = this.visibleNodesScratch
    visibleSet.clear()
    for (let i = 0; i < this.visibleIds.length; i++) visibleSet.add(this.visibleIds[i])

    // Choose LOD from the *effective* on-screen scale.
    const effective = this.camera.freeScale
    const lod: Lod = effective >= LOD_FULL ? 'full' : effective >= LOD_SIMPLE ? 'simple' : 'dot'

    // Acquire newly visible / update existing nodes.
    const flowActive = this.flow.hasActiveRuns
    for (let i = 0; i < this.visibleIds.length; i++) {
      const id = this.visibleIds[i]
      const n = this.model.nodes.get(id)
      if (!n) continue
      let override = this.flow.getOverride(id)
      // Behavioural flag: nodes flagged `hideDuringFlow` go invisible while
      // any flow effect is running on the diagram.
      if (flowActive && n.hideDuringFlow) {
        override = override
          ? { ...override, alphaMul: 0 }
          : { alphaMul: 0 }
      }
      this.nodePool.acquire(n, lod, override)
    }
    // Release nodes that fell out of view.
    for (const id of this.prevVisibleNodes) {
      if (!visibleSet.has(id)) this.nodePool.release(id)
    }
    // Swap: this frame's visibleSet becomes next frame's prev; recycle old prev as scratch.
    const oldPrev = this.prevVisibleNodes
    this.prevVisibleNodes = visibleSet
    oldPrev.clear()
    this.visibleNodesScratch = oldPrev

    // Edges — draw any edge with at least one visible endpoint. Edge-AABB
    // indexing arrives in a later stage; for now this is O(E) per dirty cycle
    // but only when something changed.
    const visibleEdges = this.visibleEdgesScratch
    visibleEdges.clear()
    for (const e of this.model.edges.values()) {
      const from = this.model.nodes.get(e.from)
      const to = this.model.nodes.get(e.to)
      if (!from || !to) continue
      if (!this.prevVisibleNodes.has(e.from) && !this.prevVisibleNodes.has(e.to)) continue
      this.edgePool.acquire(e, this.visualNode(from), this.visualNode(to))
      visibleEdges.add(e.id)
    }
    // Release edges whose endpoints are no longer near view.
    const toRelease = this.releaseScratch
    toRelease.length = 0
    this.edgePool.forEachVisible((id) => {
      if (!visibleEdges.has(id)) toRelease.push(id)
    })
    for (let i = 0; i < toRelease.length; i++) this.edgePool.release(toRelease[i])
    const oldPrevEdges = this.prevVisibleEdges
    this.prevVisibleEdges = visibleEdges
    oldPrevEdges.clear()
    this.visibleEdgesScratch = oldPrevEdges

    this.drawSelectionAndOverlays()
  }

  private drawSelectionAndOverlays(): void {
    // Selection halo, legacy-parity (Unigram CSS): a warm wave outside the
    // membrane plus one crisp blue frame. The warm aura is drawn below the
    // node as enlarged shape silhouettes; the node body covers the center,
    // leaving a visible rounded band outside without painting the face.
    let used = 0
    const HALO_COLOR = 0xffb000
    const RING_COLOR = 0x2478bd
    for (const id of this.selectedIds) {
      if (!this.prevVisibleNodes.has(id)) continue
      const node = this.model.nodes.get(id)
      if (!node) continue
      let outer = this.selectionAuraOuterPool[used]
      if (!outer) {
        outer = new Graphics(); outer.eventMode = 'none'
        this.selectionAuraOuter.addChild(outer)
        this.selectionAuraOuterPool.push(outer)
      }
      let inner = this.selectionAuraInnerPool[used]
      if (!inner) {
        inner = new Graphics(); inner.eventMode = 'none'
        this.selectionAuraInner.addChild(inner)
        this.selectionAuraInnerPool.push(inner)
      }
      let ring = this.selectionAuraRingPool[used]
      if (!ring) {
        ring = new Graphics(); ring.eventMode = 'none'
        this.selectionAuraRing.addChild(ring)
        this.selectionAuraRingPool.push(ring)
      }
      const visual = this.visualNode(node)
      const wPx = (visual.w / 100) * SCENE_W
      const hPx = (visual.h / 100) * SCENE_H
      const xPx = (visual.x / 100) * SCENE_W
      const yPx = (visual.y / 100) * SCENE_H
      const tip = node.tip
        ? { x: (node.tip.x / 100) * SCENE_W, y: (node.tip.y / 100) * SCENE_H }
        : undefined
      outer.visible = true
      outer.x = xPx; outer.y = yPx
      outer.clear()
      drawNodeShapePath(outer, visual.shape, wPx + 22, hPx + 22, tip)
      outer.fill({ color: HALO_COLOR, alpha: 0.32 })
      inner.visible = true
      inner.x = xPx; inner.y = yPx
      inner.clear()
      drawNodeShapePath(inner, visual.shape, wPx + 12, hPx + 12, tip)
      inner.fill({ color: HALO_COLOR, alpha: 0.42 })
      ring.visible = true
      ring.x = xPx; ring.y = yPx
      ring.clear()
      // Crisp blue membrane frame. The amber wave is below the node only,
      // so it never paints an inner orange membrane over the node face.
      drawNodeShapePath(ring, visual.shape, wPx, hPx, tip)
      ring.stroke({ color: RING_COLOR, width: 2.4, alignment: 1, alpha: 0.98 })
      used++
    }
    for (let i = used; i < this.selectionAuraOuterPool.length; i++) {
      this.selectionAuraOuterPool[i].visible = false
    }
    for (let i = used; i < this.selectionAuraInnerPool.length; i++) {
      this.selectionAuraInnerPool[i].visible = false
    }
    for (let i = used; i < this.selectionAuraRingPool.length; i++) {
      this.selectionAuraRingPool[i].visible = false
    }
    // Edge selection overlay (separate pool — kept distinct so the aura
    // layer doesn't blur thin edge highlights into illegibility).
    let edgeUsed = 0
    for (const eid of this.selectedEdgeIds) {
      const e = this.model.edges.get(eid)
      if (!e) continue
      const a = this.model.nodes.get(e.from)
      const b = this.model.nodes.get(e.to)
      if (!a || !b) continue
      let g = this.selectionGfxPool[edgeUsed]
      if (!g) {
        g = new Graphics(); g.eventMode = 'none'
        this.selectionLayer.addChild(g)
        this.selectionGfxPool.push(g)
      }
      g.visible = true
      g.clear()
      g.x = 0; g.y = 0
      const av = this.visualNode(a)
      const bv = this.visualNode(b)
      const ax = (av.x / 100) * SCENE_W
      const ay = (av.y / 100) * SCENE_H
      const bx = (bv.x / 100) * SCENE_W
      const by = (bv.y / 100) * SCENE_H
      const baseW = Math.max(1, (e.width / 100) * SCENE_W)
      g.moveTo(ax, ay).lineTo(bx, by)
      g.stroke({ color: RING_COLOR, width: baseW + 6, alpha: 0.4, alignment: 0.5 })
      edgeUsed++
    }
    for (let i = edgeUsed; i < this.selectionGfxPool.length; i++) {
      this.selectionGfxPool[i].visible = false
    }
    // Box-select rectangle.
    this.boxSelectGfx.clear()
    if (this.boxSelectAabb) {
      const a = this.boxSelectAabb
      const x = (a.minX / 100) * SCENE_W
      const y = (a.minY / 100) * SCENE_H
      const w = ((a.maxX - a.minX) / 100) * SCENE_W
      const h = ((a.maxY - a.minY) / 100) * SCENE_H
      this.boxSelectGfx.rect(x, y, w, h)
      this.boxSelectGfx.fill({ color: 0x4aa3ff, alpha: 0.12 })
      this.boxSelectGfx.stroke({ color: 0x4aa3ff, width: 2, alignment: 0.5 })
    }
    this.drawRmm()
    this.drawConnectGhost()
    this.drawGrid()
  }

  private drawGrid(): void {
    const grid = this.model.grid
    if (!grid || !grid.enabled) {
      this.gridLayer.visible = false
      return
    }
    const stepPct = Math.max(0.5, grid.sizePercent)
    const stepX = (stepPct / 100) * SCENE_W
    const stepY = (stepPct / 100) * SCENE_H
    // Visible scene rect → which grid cells must be drawn.
    const aabb = visibleSceneAabb(this.getCamera(), this.viewport)
    const minXpx = (aabb.minX / 100) * SCENE_W
    const maxXpx = (aabb.maxX / 100) * SCENE_W
    const minYpx = (aabb.minY / 100) * SCENE_H
    const maxYpx = (aabb.maxY / 100) * SCENE_H
    const startX = Math.floor(minXpx / stepX) * stepX
    const startY = Math.floor(minYpx / stepY) * stepY
    const g = this.gridLayer
    g.visible = true
    g.clear()
    const appearance = grid.appearance ?? 'lines'
    const invScale = 1 / Math.max(this.effectiveScale, 0.01)
    if (appearance === 'tile') {
      // Checkerboard cells. Cell parity is computed from integer indices
      // so the pattern is camera-stable.
      const i0 = Math.floor(startX / stepX)
      const j0 = Math.floor(startY / stepY)
      let j = j0
      for (let y = startY; y < maxYpx; y += stepY, j++) {
        let i = i0
        for (let x = startX; x < maxXpx; x += stepX, i++) {
          if (((i + j) & 1) === 0) continue
          g.rect(x, y, stepX, stepY)
        }
      }
      g.fill({ color: 0x4aa3ff, alpha: 0.06 })
    } else if (appearance === 'dots') {
      // A small dot at every intersection. Radius shrinks with zoom so
      // dots stay roughly screen-pixel-sized.
      const r = Math.max(0.2, 1.2 * invScale)
      for (let y = startY; y <= maxYpx; y += stepY) {
        for (let x = startX; x <= maxXpx; x += stepX) {
          g.circle(x, y, r)
        }
      }
      g.fill({ color: 0x4aa3ff, alpha: 0.35 })
    } else {
      // 'lines' — original crosshatch.
      for (let x = startX; x <= maxXpx; x += stepX) {
        g.moveTo(x, minYpx).lineTo(x, maxYpx)
      }
      for (let y = startY; y <= maxYpx; y += stepY) {
        g.moveTo(minXpx, y).lineTo(maxXpx, y)
      }
      g.stroke({
        color: 0x4aa3ff,
        width: invScale,
        alpha: 0.18,
      })
    }
  }

  /**
   * Set or clear the connection-draft ghost line.
   * Source is identified by node id so the renderer can clip the line root
   * to the shape boundary; cursor is in CSS-pixel screen coords.
   */
  setConnectGhost(
    sourceId: string | null,
    cursor: { x: number; y: number } | null,
  ): void {
    this.connectGhostSource = sourceId
    this.connectGhostCursor = cursor
    this.dirty = true
  }

  /**
   * Draw the Play cascade overlay: a brighter pulse that progressively
   * reveals each `kind:'flow'` wire as the cascade traverses it, plus a
   * pulsing halo ring around each visited node. Ports the legacy
   * `useFlowEngine.startFlowAnimation` visual feedback, but driven by
   * pre-baked schedule maps instead of a per-frame DAG walker. Coordinates
   * are scene pixels (overlayLayer is parented under `world`).
   */
  private drawFlowOverlay(now: number): void {
    const g = this.flowOverlayGfx
    const glow = this.flowWireGlowGfx
    g.clear()
    glow.clear()
    // ---- wire reveals ---------------------------------------------------
    for (const [edgeId, w] of [...this.playWires]) {
      const t = (now - w.startMs) / w.durMs
      if (t <= 0) continue
      if (t >= 1) {
        // Hold a fully-revealed flash for a beat after completion, then drop.
        if (now > w.startMs + w.durMs + 250) {
          this.playWires.delete(edgeId)
          continue
        }
      }
      const e = this.model.edges.get(edgeId)
      if (!e) { this.playWires.delete(edgeId); continue }
      const from = this.model.nodes.get(e.from)
      const to = this.model.nodes.get(e.to)
      if (!from || !to) { this.playWires.delete(edgeId); continue }
      const fromVisual = this.visualNode(from)
      const toVisual = this.visualNode(to)
      const fxC = (fromVisual.x / 100) * SCENE_W
      const fyC = (fromVisual.y / 100) * SCENE_H
      const txC = (toVisual.x / 100) * SCENE_W
      const tyC = (toVisual.y / 100) * SCENE_H
      const dx = txC - fxC
      const dy = tyC - fyC
      const len = Math.hypot(dx, dy)
      if (len < 1) continue
      const fHw = ((fromVisual.w / 100) * SCENE_W) / 2
      const fHh = ((fromVisual.h / 100) * SCENE_H) / 2
      const tHw = ((toVisual.w / 100) * SCENE_W) / 2
      const tHh = ((toVisual.h / 100) * SCENE_H) / 2
      const fEdge = shapeEdgeIntersect(fromVisual.shape, fHw, fHh, dx, dy)
      const tEdge = shapeEdgeIntersect(toVisual.shape, tHw, tHh, -dx, -dy)
      const fx = fxC + fEdge.x
      const fy = fyC + fEdge.y
      const tx = txC + tEdge.x
      const ty = tyC + tEdge.y
      const k = Math.min(1, Math.max(0, t))
      const hx = fx + (tx - fx) * k
      const hy = fy + (ty - fy) * k
      const baseStrokePx = Math.max(2, (e.width / 100) * SCENE_W * 1.4)
      // Shimmer phase 0..1 advancing over ~600 ms — drives a subtle alpha
      // wobble on the bright core for the "liquid" feel.
      const shimmer = 0.85 + 0.15 * Math.sin((now / 180) + len * 0.001)
      // Layered wire passes: warm halo (blurred), mid orange, bright core.
      glow.moveTo(fx, fy).lineTo(hx, hy)
      glow.stroke({ color: 0xffd58a, width: baseStrokePx * 4, alpha: 0.28 })
      g.moveTo(fx, fy).lineTo(hx, hy)
      g.stroke({ color: 0xffaa1f, width: baseStrokePx * 2, alpha: 0.65 })
      g.moveTo(fx, fy).lineTo(hx, hy)
      g.stroke({ color: 0xfff2c0, width: baseStrokePx * 1.0, alpha: 0.95 * shimmer })
      // Travelling head bead + short trail — only while reveal is in flight.
      if (k < 1) {
        const beadR = baseStrokePx * 1.4
        // Bead glow halo (filtered).
        glow.circle(hx, hy, beadR * 1.8)
        glow.fill({ color: 0xffd58a, alpha: 0.55 })
        // Bead bright core (crisp).
        g.circle(hx, hy, beadR)
        g.fill({ color: 0xfff7d6, alpha: 0.95 })
        // Tiny trail of fading sparks behind the bead, anchored on the line.
        const ux = (hx - fx) / Math.max(1, k * len)
        const uy = (hy - fy) / Math.max(1, k * len)
        const trail: Array<[number, number]> = [
          [beadR * 2.2, 0.55],
          [beadR * 4.0, 0.28],
          [beadR * 6.0, 0.12],
        ]
        for (const [d, a] of trail) {
          const px = hx - ux * d
          const py = hy - uy * d
          if ((px - fx) * ux + (py - fy) * uy < 0) break
          g.circle(px, py, beadR * 0.55)
          g.fill({ color: 0xfff2c0, alpha: a })
        }
      }
    }
    // ---- active node halos ---------------------------------------------
    let auraUsed = 0
    for (const [nodeId, h] of [...this.playActiveNodes]) {
      const t = (now - h.startMs) / h.durMs
      if (t <= 0) continue
      if (t >= 1) {
        this.playActiveNodes.delete(nodeId)
        continue
      }
      const n = this.model.nodes.get(nodeId)
      if (!n) { this.playActiveNodes.delete(nodeId); continue }
      const visual = this.visualNode(n)
      const cx = (visual.x / 100) * SCENE_W
      const cy = (visual.y / 100) * SCENE_H
      const wPx = (visual.w / 100) * SCENE_W
      const hPx = (visual.h / 100) * SCENE_H
      const tip = n.tip
        ? { x: (n.tip.x / 100) * SCENE_W, y: (n.tip.y / 100) * SCENE_H }
        : undefined
      // Pulse: ramp in fast, decay slow.
      const pulse = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85
      const alpha = Math.max(0, pulse)
      // Hide the legacy filled-silhouette pool (kept allocated so the scene
      // graph membership stays stable between frames).
      let aura = this.flowAuraPool[auraUsed]
      if (!aura) {
        aura = new Graphics(); aura.eventMode = 'none'
        this.flowAuraGlow.addChild(aura)
        this.flowAuraPool.push(aura)
      }
      aura.visible = false
      // Stroke-stack halo on the overlay (above nodes) — same recipe as
      // selection aura. Tight to the membrane, no rectangular bleed.
      let ring = this.flowRingPool[auraUsed]
      if (!ring) {
        ring = new Graphics(); ring.eventMode = 'none'
        this.overlayLayer.addChild(ring)
        this.flowRingPool.push(ring)
      }
      ring.visible = true
      ring.x = cx; ring.y = cy
      ring.clear()
      drawNodeShapePath(ring, visual.shape, wPx, hPx, tip)
      ring.stroke({ color: 0xffaa1f, width: 11, alignment: 1, alpha: alpha * 0.08 })
      drawNodeShapePath(ring, visual.shape, wPx, hPx, tip)
      ring.stroke({ color: 0xffaa1f, width: 6, alignment: 1, alpha: alpha * 0.22 })
      drawNodeShapePath(ring, visual.shape, wPx, hPx, tip)
      ring.stroke({ color: 0xffaa1f, width: 3, alignment: 1, alpha: alpha * 0.42 })
      drawNodeShapePath(ring, visual.shape, wPx, hPx, tip)
      ring.stroke({ color: 0xffd58a, width: 1.5, alignment: 1, alpha: alpha * 0.28 })
      auraUsed++
    }
    for (let i = auraUsed; i < this.flowAuraPool.length; i++) {
      this.flowAuraPool[i].visible = false
    }
    for (let i = auraUsed; i < this.flowRingPool.length; i++) {
      this.flowRingPool[i].visible = false
    }
  }

  private drawConnectGhost(): void {
    const srcId = this.connectGhostSource
    const cursor = this.connectGhostCursor
    const src = srcId ? this.model.nodes.get(srcId) : null
    if (!src || !cursor) {
      this.connectGhost.visible = false
      return
    }
    const visualSrc = this.visualNode(src)
    const cam = this.camera
    const s = this.effectiveScale
    const vp = this.viewport
    const cx = vp.width / 2 + (cam.panX + (visualSrc.x / 100) * SCENE_W) * s
    const cy = vp.height / 2 + (cam.panY + (visualSrc.y / 100) * SCENE_H) * s
    const dx = cursor.x - cx
    const dy = cursor.y - cy
    if (Math.hypot(dx, dy) < 1) {
      this.connectGhost.visible = false
      return
    }
    // Clip the start to the source-node boundary in screen pixels so the
    // line never overdraws the membrane.
    const hw = ((visualSrc.w / 100) * SCENE_W * s) / 2
    const hh = ((visualSrc.h / 100) * SCENE_H * s) / 2
    const edge = shapeEdgeIntersect(visualSrc.shape, hw, hh, dx, dy)
    const ax = cx + edge.x
    const ay = cy + edge.y
    const g = this.connectGhost
    g.visible = true
    g.clear()
    g.moveTo(ax, ay).lineTo(cursor.x, cursor.y)
    g.stroke({ color: 0x4aa3ff, width: 2, alpha: 0.85 })
    g.circle(cursor.x, cursor.y, 5)
    g.fill({ color: 0x4aa3ff, alpha: 0.3 })
    g.stroke({ color: 0x4aa3ff, width: 1.5, alpha: 0.9 })
  }

  /**
   * Draw the RMM inflating "canvas": a frame anchored in SCREEN coords that
   * starts at the focused node's screen position/size and grows to fill the
   * viewport. Inside, the child model is rendered at the same scale it will
   * appear at post-handoff, so the transition is visually continuous.
   */
  private drawRmm(): void {
    const focused = this.rmmFocusedId ? this.model.nodes.get(this.rmmFocusedId) : null
    const t = this.rmmSnap.nodeInflation
    if (!focused || t <= 0) {
      this.rmmStage.visible = false
      return
    }
    const vp = this.viewport
    // Focused node's current screen rect (using composed effective scale).
    const s = this.effectiveScale
    const focusScrX = vp.width / 2 + (this.camera.panX + (focused.x / 100) * SCENE_W) * s
    const focusScrY = vp.height / 2 + (this.camera.panY + (focused.y / 100) * SCENE_H) * s
    const focusScrW = (focused.w / 100) * SCENE_W * s
    const focusScrH = (focused.h / 100) * SCENE_H * s
    // Container origin lerps focus → screen-center.
    const cx = focusScrX + (vp.width / 2 - focusScrX) * t
    const cy = focusScrY + (vp.height / 2 - focusScrY) * t
    // Uniform scale lerps focus-relative-size → 1 (post-handoff render scale).
    const startScale = Math.max(focusScrW / vp.width, focusScrH / vp.height)
    const scale = startScale + (1 - startScale) * t
    this.rmmStage.visible = true
    this.rmmStage.x = cx
    this.rmmStage.y = cy
    this.rmmStage.scale.set(scale)
    // Frame: full viewport rect at scale 1; the container scale shrinks it.
    const g = this.rmmFrame
    g.clear()
    const r = Math.min(vp.width, vp.height) * 0.04
    g.roundRect(-vp.width / 2, -vp.height / 2, vp.width, vp.height, r)
    g.fill({ color: 0xffffff, alpha: 0.98 })
    g.stroke({ color: 0x4aa3ff, width: 3 / Math.max(scale, 0.01), alignment: 0.5 })
    // Child preview: drawn at post-handoff scene-pixel positions so that at
    // t=1 it visually equals what the actual nodes will look like.
    const childId = focused.childModelId
    const child = childId ? useOmniStore.getState().models.get(childId) : undefined
    this.drawChildPreview(child)
  }

  private drawChildPreview(child: Model | undefined): void {
    const c = this.rmmContent
    let g = c.children[0] as Graphics | undefined
    if (!g) {
      g = new Graphics()
      g.eventMode = 'none'
      c.addChildAt(g, 0)
    }
    g.clear()
    if (!child || child.nodes.size === 0) {
      this.releaseAllPreviewLabels()
      return
    }
    // Edges: draw with the same geometry the live EdgePool uses
    // (boundary-clipped endpoints + filled triangle arrowhead, stroke
    // width derived from `e.width` percent). This way the transition
    // from preview → live render is seamless.
    const ARROW_LEN = 16
    const ARROW_HALF_W = 7
    for (const e of child.edges.values()) {
      const a = child.nodes.get(e.from)
      const b = child.nodes.get(e.to)
      if (!a || !b) continue
      const fxC = (a.x / 100) * SCENE_W
      const fyC = (a.y / 100) * SCENE_H
      const txC = (b.x / 100) * SCENE_W
      const tyC = (b.y / 100) * SCENE_H
      const dx = txC - fxC
      const dy = tyC - fyC
      if (Math.hypot(dx, dy) < 1e-3) continue
      const fHw = ((a.w / 100) * SCENE_W) / 2
      const fHh = ((a.h / 100) * SCENE_H) / 2
      const tHw = ((b.w / 100) * SCENE_W) / 2
      const tHh = ((b.h / 100) * SCENE_H) / 2
      const fEdge = shapeEdgeIntersect(a.shape, fHw, fHh, dx, dy)
      const tEdge = shapeEdgeIntersect(b.shape, tHw, tHh, -dx, -dy)
      const fx = fxC + fEdge.x
      const fy = fyC + fEdge.y
      const tx = txC + tEdge.x
      const ty = tyC + tEdge.y
      const ndx = tx - fx
      const ndy = ty - fy
      const segLen = Math.hypot(ndx, ndy)
      if (segLen < 1e-3) continue
      const ux = ndx / segLen
      const uy = ndy / segLen
      const lineEndX = tx - ux * (ARROW_LEN * 0.6)
      const lineEndY = ty - uy * (ARROW_LEN * 0.6)
      const strokePx = Math.max(1, (e.width / 100) * SCENE_W)
      g.moveTo(fx, fy).lineTo(lineEndX, lineEndY)
      g.stroke({ color: e.color, width: strokePx, alignment: 0.5 })
      const baseX = tx - ux * ARROW_LEN
      const baseY = ty - uy * ARROW_LEN
      const px = -uy
      const py = ux
      g.poly([
        tx,
        ty,
        baseX + px * ARROW_HALF_W,
        baseY + py * ARROW_HALF_W,
        baseX - px * ARROW_HALF_W,
        baseY - py * ARROW_HALF_W,
      ])
      g.fill({ color: e.color })
    }
    // Nodes (shape only here; labels are pooled Text below).
    for (const n of child.nodes.values()) {
      g.save()
      const nx = (n.x / 100) * SCENE_W
      const ny = (n.y / 100) * SCENE_H
      const nw = (n.w / 100) * SCENE_W
      const nh = (n.h / 100) * SCENE_H
      g.translateTransform(nx, ny)
      drawNodeShape(g, n.shape, {
        w: nw,
        h: nh,
        fill: n.cellColor,
        stroke: n.membraneColor,
        strokeWidth: 2,
        tip: n.tip,
      })
      g.restore()
    }
    // Labels — pooled Text per child node; allocate as needed.
    let li = 0
    for (const n of child.nodes.values()) {
      let label = this.rmmContentLabels[li]
      if (!label) {
        label = new Text({
          text: '',
          style: { fontFamily: 'sans-serif', fontSize: 36, fill: 0x223046, align: 'center' },
        })
        label.anchor.set(0.5)
        c.addChild(label)
        this.rmmContentLabels.push(label)
      }
      label.visible = true
      if (label.text !== n.label) label.text = n.label
      label.x = (n.x / 100) * SCENE_W
      label.y = (n.y / 100) * SCENE_H
      li++
    }
    for (let i = li; i < this.rmmContentLabels.length; i++) {
      this.rmmContentLabels[i].visible = false
    }
  }

  private releaseAllPreviewLabels(): void {
    for (const t of this.rmmContentLabels) t.visible = false
  }

  /**
   * Capture the current rendered scene into a texture and overlay it as a
   * Sprite, ready for the caller to swap models underneath. Returns
   * immediately; call `playMpdCurtain` next to start the wipe animation.
   *
   * The snapshot is held until either `playMpdCurtain` finishes its tween
   * or `cancelMpdCurtain` is called, so the caller can safely mutate the
   * model in between (the user sees the snapshot, not the half-swapped
   * intermediate state).
   */
  beginMpdCurtain(): void {
    if (!this.app) return
    this.cancelMpdCurtain()
    const w = this.viewport.width
    const h = this.viewport.height
    if (w <= 0 || h <= 0) return
    // Render the live stage into a viewport-sized texture so the snapshot is
    // exactly 1:1 with what the user is currently seeing. extract.texture()
    // would return a texture sized to the world container's bounds (huge
    // and offset), which makes the snapshot Sprite glitch on display.
    let texture: RenderTexture
    try {
      texture = RenderTexture.create({
        width: w,
        height: h,
        resolution: this.app.renderer.resolution,
      })
      this.app.renderer.render({ container: this.app.stage, target: texture, clear: true })
    } catch {
      // happy-dom / non-WebGL test envs: skip silently.
      return
    }
    const sprite = new Sprite(texture)
    sprite.eventMode = 'none'
    sprite.x = 0
    sprite.y = 0
    sprite.width = w
    sprite.height = h
    const mask = new Graphics()
    mask.rect(0, 0, w, h).fill(0xffffff)
    sprite.mask = mask
    this.app.stage.addChild(mask)
    this.app.stage.addChild(sprite)
    this.curtainSprite = sprite
    this.curtainMask = mask
    // World mask in SCREEN coords clips the new scene to the brush region.
    // We attach it to the stage (not the world) so it's a screen-space mask;
    // Pixi will project the world into its bounds.
    const worldMask = new Graphics()
    // Start: empty (new scene fully hidden).
    this.app.stage.addChild(worldMask)
    this.world.mask = worldMask
    this.curtainWorldMask = worldMask
    // Brush leading-edge highlight, painted over everything for a stroke feel.
    const brush = new Graphics()
    brush.eventMode = 'none'
    this.app.stage.addChild(brush)
    this.curtainBrush = brush
  }

  /**
   * Animate the snapshot Sprite away to reveal the (already-swapped) live
   * scene below it. `direction='right'` wipes the old scene to the right
   * edge (new scene appears from the left); 'left' is the mirror.
   */
  playMpdCurtain(direction: 'left' | 'right', durationMs = 500, onDone?: () => void): void {
    if (!this.curtainSprite) {
      onDone?.()
      return
    }
    this.curtainStartMs = performance.now()
    this.curtainDurationMs = Math.max(1, durationMs)
    this.curtainDirection = direction
    this.curtainOnDone = onDone ?? null
  }

  cancelMpdCurtain(): void {
    if (this.curtainSprite) {
      this.curtainSprite.parent?.removeChild(this.curtainSprite)
      this.curtainSprite.destroy({ texture: true, textureSource: true })
      this.curtainSprite = null
    }
    if (this.curtainMask) {
      this.curtainMask.parent?.removeChild(this.curtainMask)
      this.curtainMask.destroy()
      this.curtainMask = null
    }
    if (this.curtainWorldMask) {
      // Detach from world before destroying so Pixi clears the mask binding.
      if (this.world) this.world.mask = null
      this.curtainWorldMask.parent?.removeChild(this.curtainWorldMask)
      this.curtainWorldMask.destroy()
      this.curtainWorldMask = null
    }
    if (this.curtainBrush) {
      this.curtainBrush.parent?.removeChild(this.curtainBrush)
      this.curtainBrush.destroy()
      this.curtainBrush = null
    }
    this.curtainDurationMs = 0
    this.curtainOnDone = null
  }

  private tickMpdCurtain(): void {
    if (!this.curtainSprite || !this.curtainMask || this.curtainDurationMs <= 0) return
    const t = (performance.now() - this.curtainStartMs) / this.curtainDurationMs
    const eased = t >= 1 ? 1 : t * t * (3 - 2 * t)
    const w = this.viewport.width
    const h = this.viewport.height
    const lineX = w * eased
    const oldMask = this.curtainMask
    const newMask = this.curtainWorldMask
    const brush = this.curtainBrush
    oldMask.clear()
    newMask?.clear()
    brush?.clear()
    if (this.curtainDirection === 'right') {
      // Brush sweeps L→R. Old (snapshot) visible to the right of the line;
      // new (world) visible to the left of the line.
      const oldRem = w - lineX
      if (oldRem > 0) oldMask.rect(lineX, 0, oldRem, h).fill(0xffffff)
      if (lineX > 0) newMask?.rect(0, 0, lineX, h).fill(0xffffff)
      brush?.rect(Math.max(0, lineX - 2), 0, 4, h).fill({ color: 0xcfe4ff, alpha: 0.55 })
    } else {
      // Brush sweeps R→L. Old visible on the LEFT, new on the RIGHT.
      const newStart = w - lineX
      const oldRem = w - lineX
      if (oldRem > 0) oldMask.rect(0, 0, oldRem, h).fill(0xffffff)
      if (lineX > 0) newMask?.rect(newStart, 0, lineX, h).fill(0xffffff)
      brush?.rect(Math.max(0, newStart - 2), 0, 4, h).fill({ color: 0xcfe4ff, alpha: 0.55 })
    }
    if (t >= 1) {
      const cb = this.curtainOnDone
      this.cancelMpdCurtain()
      cb?.()
    }
  }

  // ---- ephemeral spawn helpers --------------------------------------------

  private startEphemeralSpawn(
    targetId: string,
    params: Record<string, number>,
    layout: 'random' | 'circular',
  ): void {
    const node = this.model.nodes.get(targetId)
    if (!node) return
    const count = Math.max(1, Math.min(64, Math.floor(params.count ?? 6)))
    const radiusPct = Math.max(0.5, params.radius ?? 8)
    const fadeMs = Math.max(50, params.fadeMs ?? 300)
    const radiusPx = (radiusPct / 100) * SCENE_W
    // Host center in world coords.
    const cx = (node.x / 100) * SCENE_W
    const cy = (node.y / 100) * SCENE_H
    const items: { gfx: Graphics }[] = []
    for (let i = 0; i < count; i++) {
      const angle =
        layout === 'circular'
          ? (i / count) * Math.PI * 2
          : Math.random() * Math.PI * 2
      const dist =
        layout === 'circular' ? radiusPx : radiusPx * (0.4 + Math.random() * 0.6)
      const px = cx + Math.cos(angle) * dist
      const py = cy + Math.sin(angle) * dist
      const r = Math.max(2, radiusPx * 0.06)
      const g = new Graphics()
      g.circle(0, 0, r).fill({ color: 0x6ca8ff, alpha: 0.85 })
      g.x = px
      g.y = py
      g.alpha = 0
      g.scale.set(0.2)
      this.ephemeralLayer.addChild(g)
      items.push({ gfx: g })
    }
    const group: EphemeralSpawnGroup = {
      kind: layout === 'random' ? 'spawn' : 'spawn-circular',
      items,
      startedAt: performance.now(),
      fadeInMs: fadeMs,
      fadeOutMs: fadeMs,
      fadeOutStartedAt: null,
    }
    const list = this.ephemeralSpawns.get(targetId) ?? []
    list.push(group)
    this.ephemeralSpawns.set(targetId, list)
  }

  private beginEphemeralFadeOut(targetId: string, kind: 'spawn' | 'spawn-circular'): void {
    const list = this.ephemeralSpawns.get(targetId)
    if (!list) return
    const now = performance.now()
    for (const g of list) {
      if (g.kind === kind && g.fadeOutStartedAt === null) g.fadeOutStartedAt = now
    }
  }

  private tickEphemeralSpawns(): void {
    const now = performance.now()
    for (const [hostId, list] of [...this.ephemeralSpawns]) {
      const surviving: EphemeralSpawnGroup[] = []
      for (const g of list) {
        let alpha = 1
        let scale = 1
        // Fade in.
        const inT = Math.min(1, (now - g.startedAt) / g.fadeInMs)
        alpha = inT
        scale = 0.2 + 0.8 * inT
        // Fade out (overrides if active).
        if (g.fadeOutStartedAt !== null) {
          const outT = Math.min(1, (now - g.fadeOutStartedAt) / g.fadeOutMs)
          alpha = (1 - outT) * inT
          scale = 0.2 + 0.8 * (1 - outT)
          if (outT >= 1) {
            for (const it of g.items) {
              this.ephemeralLayer.removeChild(it.gfx)
              it.gfx.destroy()
            }
            continue
          }
        }
        for (const it of g.items) {
          it.gfx.alpha = alpha
          it.gfx.scale.set(scale)
        }
        surviving.push(g)
      }
      if (surviving.length === 0) this.ephemeralSpawns.delete(hostId)
      else this.ephemeralSpawns.set(hostId, surviving)
    }
  }
}

interface EphemeralSpawnGroup {
  kind: 'spawn' | 'spawn-circular'
  items: { gfx: Graphics }[]
  startedAt: number
  fadeInMs: number
  fadeOutMs: number
  fadeOutStartedAt: number | null
}

function nodeAabb(n: ModelNode) {
  return {
    minX: n.x - n.w / 2,
    minY: n.y - n.h / 2,
    maxX: n.x + n.w / 2,
    maxY: n.y + n.h / 2,
  }
}

/** Shortest distance from point (px,py) to line segment (ax,ay)-(bx,by). */
function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/**
 * Read OBS WebSocket settings from `localStorage`. Prompts the user once
 * (and persists) when no value is stored. Returns `null` when the user
 * cancels the prompt or `localStorage` is unavailable (SSR / tests).
 */
function readObsSettings(): { host: string; port: number; password: string } | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null
  const RAW = localStorage.getItem('omnigram-obs')
  if (RAW) {
    try {
      const parsed = JSON.parse(RAW)
      if (parsed && typeof parsed.host === 'string') return parsed
    } catch { /* fall through to prompt */ }
  }
  // First-time prompt — UX parity with the legacy toolbar dialog. Stored so
  // the recording flow effect runs unattended on subsequent plays.
  const hostPort = window.prompt('OBS host:port (e.g. 127.0.0.1:4455)?', '127.0.0.1:4455')
  if (!hostPort) return null
  const password = window.prompt('OBS WebSocket password (blank if none):', '') ?? ''
  const [host, portStr] = hostPort.split(':')
  const port = Number(portStr) || 4455
  const settings = { host, port, password }
  try { localStorage.setItem('omnigram-obs', JSON.stringify(settings)) } catch { /* ignore */ }
  return settings
}
