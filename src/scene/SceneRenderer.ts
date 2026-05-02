/**
 * SceneRenderer — owns the PixiJS Application, the world container with the
 * camera transform, two layers (edges below, nodes above), and the per-frame
 * cull → diff → update loop.
 *
 * Lifecycle: `await init(host)` once, `setModel({ nodes, edges })` on every
 * store rev, `setCamera(...)` whenever pan/zoom changes (hot path; bypasses
 * React). `tick()` is registered with the Pixi ticker.
 */

import { Application, Container, Graphics, RenderTexture, Sprite, Text } from 'pixi.js'
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
import { drawNodeShape, pointInShape } from './shapes'
import { shapeEdgeIntersect } from './shapeIntersect'
import { createInitialSnapshot, type HybridZoomSnapshot } from '../zoom/hybridZoom'
import { ParticleLayer } from '../theme/ParticleLayer'
import { FlowRuntime } from '../flow/runtime'
import { TextGenRunner, type TextGenConfig } from '../audio/TextGenRunner'
import type { FlowEffect } from '../flow/types'

export interface ModelView {
  nodes: ReadonlyMap<string, ModelNode>
  edges: ReadonlyMap<string, Connection>
  grid?: { enabled: boolean; snap: boolean; sizePercent: number }
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
  readonly textGen = new TextGenRunner()

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
    this.overlayLayer = new Container()
    this.overlayLayer.eventMode = 'none'
    this.boxSelectGfx = new Graphics()
    this.overlayLayer.addChild(this.boxSelectGfx)
    this.world.addChild(this.gridLayer)
    this.world.addChild(this.edgesLayer)
    this.world.addChild(this.nodesLayer)
    this.world.addChild(this.selectionLayer)
    this.world.addChild(this.overlayLayer)
    app.stage.addChild(this.world)
    // Particle overlay sits above world (screen-anchored), below RMM stage.
    this.particleLayer = new ParticleLayer()
    app.stage.addChild(this.particleLayer.container)
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
    this.particleLayer.setViewport(this.viewport.width, this.viewport.height)
    this.applyCameraTransform()
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

  /** The Pixi-owned canvas (for capture / screenshot). */
  getCanvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null
  }

  /** Start a flow effect against a target node. Returns a runId (or null). */
  playFlowEffect(targetNodeId: string, effect: FlowEffect): string | null {
    return this.flow.start(targetNodeId, effect, performance.now())
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

  // ---- internals ----------------------------------------------------------

  private onTick = (ticker: { deltaMS: number }): void => {
    if (!this.app) return
    // Resize tracking: Pixi's resizeTo handles canvas; we mirror viewport size.
    if (
      this.viewport.width !== this.app.screen.width ||
      this.viewport.height !== this.app.screen.height
    ) {
      this.viewport = { width: this.app.screen.width, height: this.app.screen.height }
      this.particleLayer.setViewport(this.viewport.width, this.viewport.height)
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
      this.cullAndDraw()
    }
    // Text-generator: progressively reveals labels in-place. When characters
    // advance we mark dirty and redraw so the new label is baked into Pixi.
    if (this.textGen.hasActiveRuns) {
      const changed = this.textGen.tick(this.model.nodes, performance.now())
      if (changed) this.cullAndDraw()
    }
    // MPD curtain animates each frame; runs only when active.
    if (this.curtainDurationMs > 0) this.tickMpdCurtain()
    // Particle simulation (no-op when no preset is set).
    if (this.particlePresetId) {
      // Convert deltaMS to "frames" (1.0 = 16.67 ms) so legacy preset tuning
      // remains accurate at any refresh rate.
      this.particleLayer.tick(ticker.deltaMS / 16.667)
    }
    // Selection breathing animation: alpha pulse on the selectionLayer.
    // (Scaling the whole layer would drift rings off origin; per-ring scale
    // would need per-frame draws — alpha alone is free.)
    if (this.selectedIds.size > 0) {
      const phase = (performance.now() % 1400) / 1400
      const pulse = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2)
      this.selectionLayer.alpha = 0.65 + 0.35 * pulse
    } else if (this.selectionLayer.alpha !== 1) {
      this.selectionLayer.alpha = 1
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
    // Effective scale composes user free-zoom with RMM cameraScale.
    this.effectiveScale = this.camera.freeScale * this.rmmSnap.cameraScale
    // Scene coords are signed percent around (0,0) = viewport center.
    // World children draw at scene-pixel positions (scene% / 100 * SCENE_W).
    this.world.scale.set(this.effectiveScale)
    this.world.x = this.viewport.width / 2 + this.camera.panX * this.effectiveScale
    this.world.y = this.viewport.height / 2 + this.camera.panY * this.effectiveScale
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
      this.edgePool.acquire(e, from, to)
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
    // Reuse a small pool of selection ring Graphics. One per visible+selected
    // node. Hidden when not in use. Animation (alpha pulse + outer ring scale)
    // is applied in `onTick` directly on the shared selectionLayer to avoid
    // re-issuing draw commands per frame.
    let used = 0
    for (const id of this.selectedIds) {
      if (!this.prevVisibleNodes.has(id)) continue
      const node = this.model.nodes.get(id)
      if (!node) continue
      let g = this.selectionGfxPool[used]
      if (!g) {
        g = new Graphics()
        g.eventMode = 'none'
        this.selectionLayer.addChild(g)
        this.selectionGfxPool.push(g)
      }
      g.visible = true
      g.clear()
      const pad = 1.2
      const wPx = ((node.w + pad * 2) / 100) * SCENE_W
      const hPx = ((node.h + pad * 2) / 100) * SCENE_H
      const xPx = (node.x / 100) * SCENE_W
      const yPx = (node.y / 100) * SCENE_H
      g.x = xPx
      g.y = yPx
      const r = Math.min(wPx, hPx) * 0.18
      // Outer halo (drawn first, faint).
      g.roundRect(-wPx / 2 - 6, -hPx / 2 - 6, wPx + 12, hPx + 12, r + 6)
      g.stroke({ color: 0x4aa3ff, width: 2, alpha: 0.35, alignment: 0.5 })
      // Inner crisp ring.
      g.roundRect(-wPx / 2, -hPx / 2, wPx, hPx, r)
      g.stroke({ color: 0x4aa3ff, width: 3, alignment: 0.5 })
      used++
    }
    for (let i = used; i < this.selectionGfxPool.length; i++) {
      this.selectionGfxPool[i].visible = false
    }
    // Edge selection: thicker translucent overlay along each selected edge.
    for (const eid of this.selectedEdgeIds) {
      const e = this.model.edges.get(eid)
      if (!e) continue
      const a = this.model.nodes.get(e.from)
      const b = this.model.nodes.get(e.to)
      if (!a || !b) continue
      let g = this.selectionGfxPool[used]
      if (!g) {
        g = new Graphics()
        g.eventMode = 'none'
        this.selectionLayer.addChild(g)
        this.selectionGfxPool.push(g)
      }
      g.visible = true
      g.clear()
      g.x = 0
      g.y = 0
      const ax = (a.x / 100) * SCENE_W
      const ay = (a.y / 100) * SCENE_H
      const bx = (b.x / 100) * SCENE_W
      const by = (b.y / 100) * SCENE_H
      const baseW = Math.max(1, (e.width / 100) * SCENE_W)
      g.moveTo(ax, ay).lineTo(bx, by)
      g.stroke({ color: 0x4aa3ff, width: baseW + 6, alpha: 0.4, alignment: 0.5 })
      used++
    }
    for (let i = used; i < this.selectionGfxPool.length; i++) {
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
    // Visible scene rect → which grid lines must be drawn.
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
    for (let x = startX; x <= maxXpx; x += stepX) {
      g.moveTo(x, minYpx).lineTo(x, maxYpx)
    }
    for (let y = startY; y <= maxYpx; y += stepY) {
      g.moveTo(minXpx, y).lineTo(maxXpx, y)
    }
    g.stroke({
      color: 0x4aa3ff,
      width: 1 / Math.max(this.effectiveScale, 0.01),
      alpha: 0.18,
    })
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

  private drawConnectGhost(): void {
    const srcId = this.connectGhostSource
    const cursor = this.connectGhostCursor
    const src = srcId ? this.model.nodes.get(srcId) : null
    if (!src || !cursor) {
      this.connectGhost.visible = false
      return
    }
    const cam = this.camera
    const s = this.effectiveScale
    const vp = this.viewport
    const cx = vp.width / 2 + (cam.panX + (src.x / 100) * SCENE_W) * s
    const cy = vp.height / 2 + (cam.panY + (src.y / 100) * SCENE_H) * s
    const dx = cursor.x - cx
    const dy = cursor.y - cy
    if (Math.hypot(dx, dy) < 1) {
      this.connectGhost.visible = false
      return
    }
    // Clip the start to the source-node boundary in screen pixels so the
    // line never overdraws the membrane.
    const hw = ((src.w / 100) * SCENE_W * s) / 2
    const hh = ((src.h / 100) * SCENE_H * s) / 2
    const edge = shapeEdgeIntersect(src.shape, hw, hh, dx, dy)
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
