/**
 * SceneRenderer — owns the PixiJS Application, the world container with the
 * camera transform, two layers (edges below, nodes above), and the per-frame
 * cull → diff → update loop.
 *
 * Lifecycle: `await init(host)` once, `setModel({ nodes, edges })` on every
 * store rev, `setCamera(...)` whenever pan/zoom changes (hot path; bypasses
 * React). `tick()` is registered with the Pixi ticker.
 */

import { Application, Container } from 'pixi.js'
import {
  LOD_FULL,
  LOD_SIMPLE,
  type CameraTransform,
  type SceneAabb,
  type ViewportSize,
  visibleSceneAabb,
} from './sceneConstants'
import { Quadtree } from '../spatial/quadtree'
import type { Connection, ModelNode } from '../model/types'
import { EdgePool } from './EdgePool'
import { NodePool, type Lod } from './NodePool'

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
  private nodePool!: NodePool
  private edgePool!: EdgePool
  private quadtree = new Quadtree()
  private model: ModelView = { nodes: new Map(), edges: new Map() }
  private camera: CameraTransform = { panX: 0, panY: 0, freeScale: 1 }
  private viewport: ViewportSize = { width: 0, height: 0 }

  // Reusable scratch buffers — keep hot path GC-free.
  private visibleIds: string[] = []
  private prevVisibleNodes = new Set<string>()

  // FPS sampling.
  private fps = 0
  private fpsAccumFrames = 0
  private fpsAccumTimeMs = 0

  /** Bumped externally whenever the model maps change. */
  private dirty = true

  async init(host: HTMLElement): Promise<void> {
    if (this.app) throw new Error('SceneRenderer already initialised')
    const app = new Application()
    this.app = app
    await app.init({
      preference: 'webgl',
      resizeTo: host,
      antialias: true,
      backgroundAlpha: 1,
      backgroundColor: 0xf6f9fc,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    host.appendChild(app.canvas)
    this.world = new Container()
    this.world.eventMode = 'none'
    this.edgesLayer = new Container()
    this.edgesLayer.eventMode = 'none'
    this.nodesLayer = new Container()
    this.nodesLayer.eventMode = 'none'
    this.world.addChild(this.edgesLayer)
    this.world.addChild(this.nodesLayer)
    app.stage.addChild(this.world)
    this.nodePool = new NodePool(this.nodesLayer)
    this.edgePool = new EdgePool(this.edgesLayer)
    this.viewport = { width: app.screen.width, height: app.screen.height }
    this.applyCameraTransform()
    app.ticker.add(this.onTick)
  }

  destroy(): void {
    if (!this.app) return
    try {
      this.app.ticker?.remove(this.onTick)
    } catch {
      /* ticker may not exist if init failed */
    }
    this.nodePool?.destroy()
    this.edgePool?.destroy()
    try {
      this.app.destroy(true, { children: true })
    } catch {
      /* destroy may fail on a half-initialised app */
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
    // Return the last-acquired (topmost in render order) hit.
    let best: string | null = null
    for (const id of hits) {
      if (this.model.nodes.has(id)) best = id
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

  private rebuildQuadtree(): void {
    this.quadtree.clear()
    for (const n of this.model.nodes.values()) {
      this.quadtree.insert(n.id, nodeAabb(n))
    }
  }

  private cullAndDraw(): void {
    if (!this.app) return
    const visibleAabb: SceneAabb = visibleSceneAabb(this.camera, this.viewport, CULL_PADDING)
    // Without a center-anchored coordinate system in the renderer, we work in
    // scene-percent directly; visibleAabb is already in scene percent.
    this.quadtree.query(visibleAabb, this.visibleIds)
    const visibleSet = new Set<string>(this.visibleIds)

    // Choose LOD from the *effective* on-screen scale.
    const effective = this.camera.freeScale
    const lod: Lod = effective >= LOD_FULL ? 'full' : effective >= LOD_SIMPLE ? 'simple' : 'dot'

    // Acquire newly visible / update existing nodes.
    for (const id of this.visibleIds) {
      const n = this.model.nodes.get(id)
      if (!n) continue
      this.nodePool.acquire(n, lod)
    }
    // Release nodes that fell out of view.
    if (this.prevVisibleNodes.size > 0) {
      for (const id of this.prevVisibleNodes) {
        if (!visibleSet.has(id)) this.nodePool.release(id)
      }
    }
    this.prevVisibleNodes = visibleSet

    // Edges — at stage 1 we draw every edge whose endpoints are both indexed
    // and at least one endpoint is visible. (Edge-AABB indexing comes later.)
    const visibleEdges = new Set<string>()
    for (const e of this.model.edges.values()) {
      const from = this.model.nodes.get(e.from)
      const to = this.model.nodes.get(e.to)
      if (!from || !to) continue
      if (!visibleSet.has(e.from) && !visibleSet.has(e.to)) continue
      this.edgePool.acquire(e, from, to)
      visibleEdges.add(e.id)
    }
    // Release edges whose endpoints are no longer near view.
    const toRelease: string[] = []
    this.edgePool.forEachVisible((id) => {
      if (!visibleEdges.has(id)) toRelease.push(id)
    })
    for (const id of toRelease) this.edgePool.release(id)
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
