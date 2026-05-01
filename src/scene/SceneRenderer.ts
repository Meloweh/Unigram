/**
 * SceneRenderer — owns the PixiJS Application, the world container with the
 * camera transform, two layers (edges below, nodes above), and the per-frame
 * cull → diff → update loop.
 *
 * Lifecycle: `await init(host)` once, `setModel({ nodes, edges })` on every
 * store rev, `setCamera(...)` whenever pan/zoom changes (hot path; bypasses
 * React). `tick()` is registered with the Pixi ticker.
 */

import { Application, Container, Graphics } from 'pixi.js'
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
import { createInitialSnapshot, type HybridZoomSnapshot } from '../zoom/hybridZoom'

export interface ModelView {
  nodes: ReadonlyMap<string, ModelNode>
  edges: ReadonlyMap<string, Connection>
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
  /** Selection rings, drawn over `nodesLayer` and rebuilt only on dirty. */
  private selectionLayer!: Container
  /** Box-select rectangle (single Graphics). */
  private boxSelectGfx!: Graphics
  private nodePool!: NodePool
  private edgePool!: EdgePool
  private quadtree = new Quadtree()
  private model: ModelView = { nodes: new Map(), edges: new Map() }
  private camera: CameraTransform = { panX: 0, panY: 0, freeScale: 1 }
  private viewport: ViewportSize = { width: 0, height: 0 }
  private selectedIds: ReadonlySet<string> = new Set()
  private selectionGfxPool: Graphics[] = []
  private boxSelectAabb: SceneAabb | null = null
  /** RMM inflating-frame overlay (one Graphics + a child-preview container). */
  private rmmFrame!: Graphics
  private rmmPreview!: Container
  private rmmSnap: HybridZoomSnapshot = createInitialSnapshot()
  private rmmFocusedId: string | null = null

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
      backgroundAlpha: 1,
      backgroundColor: 0xf6f9fc,
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
    this.nodesLayer = new Container()
    this.nodesLayer.eventMode = 'none'
    this.selectionLayer = new Container()
    this.selectionLayer.eventMode = 'none'
    this.overlayLayer = new Container()
    this.overlayLayer.eventMode = 'none'
    this.boxSelectGfx = new Graphics()
    this.overlayLayer.addChild(this.boxSelectGfx)
    this.rmmPreview = new Container()
    this.rmmPreview.eventMode = 'none'
    this.rmmPreview.visible = false
    this.rmmFrame = new Graphics()
    this.rmmFrame.eventMode = 'none'
    this.rmmFrame.visible = false
    this.overlayLayer.addChild(this.rmmFrame)
    this.overlayLayer.addChild(this.rmmPreview)
    this.world.addChild(this.edgesLayer)
    this.world.addChild(this.nodesLayer)
    this.world.addChild(this.selectionLayer)
    this.world.addChild(this.overlayLayer)
    app.stage.addChild(this.world)
    this.nodePool = new NodePool(this.nodesLayer)
    this.edgePool = new EdgePool(this.edgesLayer)
    this.viewport = { width: app.screen.width, height: app.screen.height }
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
    this.nodePool?.destroy()
    this.edgePool?.destroy()
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
    this.dirty = true
  }

  /** Query node ids whose AABB intersects `aabb`. Reuses caller-supplied buffer. */
  queryAabb(aabb: SceneAabb, out: string[] = []): string[] {
    return this.quadtree.query(aabb, out)
  }

  /** Hot path: pan/zoom directly. Does NOT touch the store. */
  setCamera(c: CameraTransform): void {
    this.camera = c
    this.applyCameraTransform()
    this.dirty = true
  }

  getCamera(): CameraTransform {
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

  // ---- internals ----------------------------------------------------------

  private onTick = (ticker: { deltaMS: number }): void => {
    if (!this.app) return
    // Resize tracking: Pixi's resizeTo handles canvas; we mirror viewport size.
    if (
      this.viewport.width !== this.app.screen.width ||
      this.viewport.height !== this.app.screen.height
    ) {
      this.viewport = { width: this.app.screen.width, height: this.app.screen.height }
      this.dirty = true
    }
    if (this.dirty) {
      this.cullAndDraw()
      this.dirty = false
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
    // Scene coords are signed percent around (0,0) = viewport center.
    // World children draw at scene-pixel positions (scene% / 100 * SCENE_W).
    this.world.scale.set(this.camera.freeScale)
    this.world.x = this.viewport.width / 2 + this.camera.panX * this.camera.freeScale
    this.world.y = this.viewport.height / 2 + this.camera.panY * this.camera.freeScale
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
  ): void {
    this.model = { nodes, edges }
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
    for (let i = 0; i < this.visibleIds.length; i++) {
      const id = this.visibleIds[i]
      const n = this.model.nodes.get(id)
      if (!n) continue
      this.nodePool.acquire(n, lod)
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
    // node. Hidden when not in use.
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
      // Selection ring: scene-percent rect 1.5pp larger than node AABB,
      // 0.4pp dashed-equivalent stroke (solid for stage 3).
      const pad = 1
      const wPx = ((node.w + pad * 2) / 100) * SCENE_W
      const hPx = ((node.h + pad * 2) / 100) * SCENE_H
      const xPx = (node.x / 100) * SCENE_W
      const yPx = (node.y / 100) * SCENE_H
      g.x = xPx
      g.y = yPx
      const r = Math.min(wPx, hPx) * 0.18
      g.roundRect(-wPx / 2, -hPx / 2, wPx, hPx, r)
      g.stroke({ color: 0x4aa3ff, width: 3, alignment: 0.5 })
      used++
    }
    // Hide unused rings.
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
  }

  /**
   * Draw the RMM inflating frame around the focused node and a static
   * simplified preview of its child model inside. Allocation-light: the
   * frame is one Graphics, the preview is a Container of one Graphics per
   * child node (child models are typically tens of nodes — cheap to redraw).
   */
  private drawRmm(): void {
    const focused = this.rmmFocusedId ? this.model.nodes.get(this.rmmFocusedId) : null
    const t = this.rmmSnap.nodeInflation
    if (!focused || t <= 0) {
      this.rmmFrame.visible = false
      this.rmmPreview.visible = false
      return
    }
    // Base node bounds in scene pixels.
    const baseW = (focused.w / 100) * SCENE_W
    const baseH = (focused.h / 100) * SCENE_H
    // Target bounds: cover the visible scene rect at full inflation.
    const visAabb = visibleSceneAabb(this.camera, this.viewport, 0)
    const targetW = ((visAabb.maxX - visAabb.minX) / 100) * SCENE_W
    const targetH = ((visAabb.maxY - visAabb.minY) / 100) * SCENE_H
    const w = baseW + (targetW - baseW) * t
    const h = baseH + (targetH - baseH) * t
    const xPx = (focused.x / 100) * SCENE_W
    const yPx = (focused.y / 100) * SCENE_H

    // Frame.
    const g = this.rmmFrame
    g.visible = true
    g.x = xPx
    g.y = yPx
    g.clear()
    const r = Math.min(w, h) * 0.06
    g.roundRect(-w / 2, -h / 2, w, h, r)
    g.fill({ color: 0xffffff, alpha: 0.96 })
    g.stroke({ color: 0x4aa3ff, width: 4, alignment: 0.5 })

    // Child-model preview: load lazily from the store registry.
    const childId = focused.childModelId
    const child = childId ? useOmniStore.getState().models.get(childId) : undefined
    this.rmmPreview.visible = true
    this.rmmPreview.x = xPx
    this.rmmPreview.y = yPx
    this.drawChildPreview(child, w, h, t)
  }

  /** Render a simplified, static preview of `child` clipped into a w×h box. */
  private drawChildPreview(child: Model | undefined, w: number, h: number, alpha: number): void {
    // Reuse one pooled Graphics; clear and redraw each frame. Child models
    // are intentionally small (≲ a few dozen nodes), so cost is negligible.
    const c = this.rmmPreview
    while (c.children.length > 1) c.removeChildAt(c.children.length - 1).destroy()
    let g = c.children[0] as Graphics | undefined
    if (!g) {
      g = new Graphics()
      g.eventMode = 'none'
      c.addChild(g)
    }
    g.clear()
    if (!child || child.nodes.size === 0) {
      // No child available — draw a label-style placeholder.
      g.rect(-w / 2 + 8, -h / 2 + 8, 80, 18)
      g.fill({ color: 0xe8eef7, alpha: alpha })
      return
    }
    // Compute child bounds in scene-percent so we can scale into w×h.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of child.nodes.values()) {
      minX = Math.min(minX, n.x - n.w / 2)
      minY = Math.min(minY, n.y - n.h / 2)
      maxX = Math.max(maxX, n.x + n.w / 2)
      maxY = Math.max(maxY, n.y + n.h / 2)
    }
    const cw = Math.max(1, maxX - minX)
    const ch = Math.max(1, maxY - minY)
    const pad = 0.85
    const sx = (w * pad) / ((cw / 100) * SCENE_W)
    const sy = (h * pad) / ((ch / 100) * SCENE_H)
    const s = Math.min(sx, sy)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    // Edges (thin grey lines).
    for (const e of child.edges.values()) {
      const a = child.nodes.get(e.from)
      const b = child.nodes.get(e.to)
      if (!a || !b) continue
      const ax = ((a.x - cx) / 100) * SCENE_W * s
      const ay = ((a.y - cy) / 100) * SCENE_H * s
      const bx = ((b.x - cx) / 100) * SCENE_W * s
      const by = ((b.y - cy) / 100) * SCENE_H * s
      g.moveTo(ax, ay).lineTo(bx, by)
    }
    g.stroke({ color: 0x7a8aa0, width: 1.2, alpha: alpha * 0.7 })
    // Nodes.
    for (const n of child.nodes.values()) {
      g.save()
      const nx = ((n.x - cx) / 100) * SCENE_W * s
      const ny = ((n.y - cy) / 100) * SCENE_H * s
      const nw = (n.w / 100) * SCENE_W * s
      const nh = (n.h / 100) * SCENE_H * s
      g.translateTransform(nx, ny)
      drawNodeShape(g, n.shape, {
        w: nw,
        h: nh,
        fill: n.cellColor,
        stroke: n.membraneColor,
        strokeWidth: 1.5,
        tip: n.tip,
      })
      g.restore()
    }
    g.alpha = alpha
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
