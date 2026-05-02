/**
 * PointerController — wires browser pointer events on the host element to
 * scene-level interactions:
 *   - left-drag empty: pan (writes camera directly to renderer; commits to
 *     store on pointerup).
 *   - left-drag node: move (writes node position directly via renderer pool;
 *     commits to store on pointerup).
 *   - click empty: clear selection.
 *   - click node: single-select.
 *   - double-click empty: add node at scene coords.
 *   - right-drag node: draft connection (renderer-only ghost line); commits
 *     on pointerup if dropped on another node.
 *
 * The controller never touches React. It pulls the model/store lazily from a
 * supplied accessor so it doesn't capture a stale snapshot.
 */

import { Graphics } from 'pixi.js'
import { clientToScene } from '../scene/sceneConstants'
import type { SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore } from '../model/store'

interface ActiveDrag {
  kind: 'pan' | 'node' | 'connect' | 'box'
  pointerId: number
  startClient: { x: number; y: number }
  startScene: { x: number; y: number }
  // For 'node' (drag, possibly multi):
  nodeId?: string
  /** Per-id baseline x/y captured at drag start, for renderer + commit. */
  dragBaselines?: Array<{ id: string; x: number; y: number }>
  // For 'pan':
  startCamera?: { panX: number; panY: number }
  // For 'connect':
  ghost?: Graphics
  hoverTargetId?: string | null
  // For 'box':
  /** Whether shift was held → additive box-select (preserves prior selection). */
  additive?: boolean
  /** Snapshot of selection at gesture start (for additive box-select). */
  baseSelection?: ReadonlySet<string>
  totalMoved?: number
}

const CLICK_THRESHOLD_PX = 4
const DOUBLE_CLICK_MS = 300
const DRAG_TICKER_TAG = 'omni-pointer'

export interface PointerControllerOptions {
  snap?: number
}

export class PointerController {
  private active: ActiveDrag | null = null
  private lastClickAt = 0
  private lastClickPos = { x: 0, y: 0 }
  private lastNodeClickId: string | null = null
  private lastNodeClickAt = 0
  private readonly host: HTMLElement
  private readonly renderer: SceneRenderer

  /** Effective snap step (scene-percent). 0 = snapping off. */
  private get snapStep(): number {
    const grid = useOmniStore.getState().model.grid
    if (!grid || !grid.snap) return 0
    return Math.max(0, grid.sizePercent)
  }

  constructor(
    host: HTMLElement,
    renderer: SceneRenderer,
    options: PointerControllerOptions = {},
  ) {
    this.host = host
    this.renderer = renderer
    void options
    host.addEventListener('pointerdown', this.onPointerDown)
    host.addEventListener('pointermove', this.onPointerMove)
    host.addEventListener('pointerup', this.onPointerUp)
    host.addEventListener('pointercancel', this.onPointerUp)
    host.addEventListener('contextmenu', this.onContextMenu)
  }

  destroy(): void {
    this.host.removeEventListener('pointerdown', this.onPointerDown)
    this.host.removeEventListener('pointermove', this.onPointerMove)
    this.host.removeEventListener('pointerup', this.onPointerUp)
    this.host.removeEventListener('pointercancel', this.onPointerUp)
    this.host.removeEventListener('contextmenu', this.onContextMenu)
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
  }

  private toScene(e: PointerEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect()
    return clientToScene(
      e.clientX - rect.left,
      e.clientY - rect.top,
      this.renderer.getCamera(),
      this.renderer.getViewport(),
    )
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.active) return
    const scene = this.toScene(e)
    const hitId = this.renderer.pickNode(scene.x, scene.y)
    const isRight = e.button === 2
    const shift = e.shiftKey
    this.host.setPointerCapture(e.pointerId)

    if (isRight && hitId) {
      // Begin connection draft.
      this.active = {
        kind: 'connect',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        nodeId: hitId,
        ghost: undefined,
        hoverTargetId: null,
        totalMoved: 0,
      }
      return
    }

    if (isRight && !hitId) {
      // Right-drag empty → box-select.
      this.active = {
        kind: 'box',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        additive: shift,
        baseSelection: new Set(useOmniStore.getState().selectedIds),
        totalMoved: 0,
      }
      this.renderer.setBoxSelect({
        minX: scene.x,
        minY: scene.y,
        maxX: scene.x,
        maxY: scene.y,
      })
      return
    }

    if (e.button === 0 && hitId) {
      const store = useOmniStore.getState()
      const node = store.model.nodes.get(hitId)
      if (!node) return
      // Selection rules:
      //   shift + click → toggle membership in current selection
      //   click on already-selected node → keep selection (start multi-drag)
      //   click on unselected node → replace selection with just this id
      if (shift) {
        store.select(hitId, true)
      } else if (!store.selectedIds.has(hitId)) {
        store.select(hitId, false)
      }
      // Build baselines for whatever is selected now (post-select). Locked
      // nodes are skipped (legacy parity: locked nodes refuse drag and
      // untangle).
      const sel = useOmniStore.getState().selectedIds
      const baselines: Array<{ id: string; x: number; y: number }> = []
      if (sel.size > 1 && sel.has(hitId)) {
        for (const id of sel) {
          const n = useOmniStore.getState().model.nodes.get(id)
          if (n && !n.locked) baselines.push({ id, x: n.x, y: n.y })
        }
      } else if (!node.locked) {
        baselines.push({ id: hitId, x: node.x, y: node.y })
      }
      if (baselines.length === 0) {
        // Whole selection (or the single click target) is locked — leave
        // selection as-is, but don't begin a drag.
        return
      }
      this.active = {
        kind: 'node',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        nodeId: hitId,
        dragBaselines: baselines,
        totalMoved: 0,
      }
      return
    }

    if (e.button === 0) {
      // Empty-space drag → pan.
      const cam = this.renderer.getCamera()
      this.active = {
        kind: 'pan',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        startCamera: { panX: cam.panX, panY: cam.panY },
        totalMoved: 0,
      }
      return
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const a = this.active
    if (!a || e.pointerId !== a.pointerId) return
    const dxClient = e.clientX - a.startClient.x
    const dyClient = e.clientY - a.startClient.y
    a.totalMoved = (a.totalMoved ?? 0) + Math.hypot(dxClient, dyClient)

    if (a.kind === 'pan' && a.startCamera) {
      const scale = this.renderer.getCamera().freeScale
      this.renderer.setCamera({
        panX: a.startCamera.panX + dxClient / scale,
        panY: a.startCamera.panY + dyClient / scale,
        freeScale: scale,
      })
      return
    }

    if (a.kind === 'node' && a.dragBaselines) {
      const sceneNow = this.toScene(e)
      const sceneStart = a.startScene
      const dx = sceneNow.x - sceneStart.x
      const dy = sceneNow.y - sceneStart.y
      // Renderer-direct write for every dragged node. Mutates the live
      // ModelNode and quadtree; commit is one transaction on pointerup.
      for (let i = 0; i < a.dragBaselines.length; i++) {
        const b = a.dragBaselines[i]
        this.renderer.moveNodeDirect(b.id, b.x + dx, b.y + dy)
      }
      return
    }

    if (a.kind === 'box') {
      const sceneNow = this.toScene(e)
      const aabb = {
        minX: Math.min(a.startScene.x, sceneNow.x),
        minY: Math.min(a.startScene.y, sceneNow.y),
        maxX: Math.max(a.startScene.x, sceneNow.x),
        maxY: Math.max(a.startScene.y, sceneNow.y),
      }
      this.renderer.setBoxSelect(aabb)
      return
    }

    if (a.kind === 'connect' && a.nodeId) {
      const sceneNow = this.toScene(e)
      const hoverId = this.renderer.pickNode(sceneNow.x, sceneNow.y)
      a.hoverTargetId = hoverId && hoverId !== a.nodeId ? hoverId : null
      const rect = this.host.getBoundingClientRect()
      this.renderer.setConnectGhost(a.nodeId, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
      return
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    const a = this.active
    if (!a || e.pointerId !== a.pointerId) return
    this.active = null
    try {
      this.host.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    const movedFar = (a.totalMoved ?? 0) > CLICK_THRESHOLD_PX

    if (a.kind === 'pan' && !movedFar) {
      // Click on empty space.
      this.handleEmptyClick(e, a.startScene)
      return
    }

    if (a.kind === 'pan' && a.startCamera) {
      // Push the new camera to the store (camera is NOT undoable per spec).
      const cam = this.renderer.getCamera()
      useOmniStore.getState().setCamera(cam)
      return
    }

    if (a.kind === 'node' && a.dragBaselines) {
      if (movedFar) {
        // Snap each dragged node to the grid using the *first* node as the
        // anchor so the relative offsets are preserved.
        const store = useOmniStore.getState()
        const anchor = a.dragBaselines[0]
        const cur = store.model.nodes.get(anchor.id)
        if (cur) {
          const snapped = snapToGrid(cur.x, cur.y, this.snapStep)
          const sx = snapped.x - cur.x
          const sy = snapped.y - cur.y
          if (sx !== 0 || sy !== 0) {
            for (let i = 0; i < a.dragBaselines.length; i++) {
              const b = a.dragBaselines[i]
              const live = store.model.nodes.get(b.id)
              if (!live) continue
              this.renderer.moveNodeDirect(b.id, live.x + sx, live.y + sy)
            }
          }
        }
        store.commitDrag(a.dragBaselines)
      } else if (a.nodeId) {
        // Click on node — detect double-click → enter inline label edit.
        const now = e.timeStamp
        if (
          this.lastNodeClickId === a.nodeId &&
          now - this.lastNodeClickAt < DOUBLE_CLICK_MS
        ) {
          useOmniStore.getState().setEditingNode(a.nodeId)
          this.lastNodeClickId = null
          this.lastNodeClickAt = 0
        } else {
          this.lastNodeClickId = a.nodeId
          this.lastNodeClickAt = now
        }
      }
      return
    }

    if (a.kind === 'box') {
      this.renderer.setBoxSelect(null)
      const sceneNow = this.toScene(e)
      const aabb = {
        minX: Math.min(a.startScene.x, sceneNow.x),
        minY: Math.min(a.startScene.y, sceneNow.y),
        maxX: Math.max(a.startScene.x, sceneNow.x),
        maxY: Math.max(a.startScene.y, sceneNow.y),
      }
      const hits: string[] = []
      this.renderer.queryAabb(aabb, hits)
      const next = a.additive && a.baseSelection ? new Set(a.baseSelection) : new Set<string>()
      for (let i = 0; i < hits.length; i++) next.add(hits[i])
      useOmniStore.getState().selectMany(next)
      return
    }

    if (a.kind === 'connect' && a.nodeId) {
      this.renderer.setConnectGhost(null, null)
      const drop = this.toScene(e)
      const targetId = this.renderer.pickNode(drop.x, drop.y)
      if (targetId && targetId !== a.nodeId) {
        const kind = useOmniStore.getState().defaultConnectionKind
        useOmniStore.getState().addEdge(a.nodeId, targetId, { kind })
      }
      a.ghost?.destroy()
      return
    }
  }

  private handleEmptyClick(e: PointerEvent, scene: { x: number; y: number }): void {
    const now = e.timeStamp
    const dt = now - this.lastClickAt
    const dx = e.clientX - this.lastClickPos.x
    const dy = e.clientY - this.lastClickPos.y
    const isDouble = dt < DOUBLE_CLICK_MS && Math.hypot(dx, dy) < CLICK_THRESHOLD_PX * 2
    this.lastClickAt = now
    this.lastClickPos = { x: e.clientX, y: e.clientY }

    if (isDouble) {
      const snapped = snapToGrid(scene.x, scene.y, this.snapStep)
      const id = useOmniStore.getState().addNode({
        x: snapped.x,
        y: snapped.y,
        label: 'node',
      })
      useOmniStore.getState().select(id)
      return
    }
    // Single click on empty space — try an edge hit before clearing selection.
    const edgeId = this.renderer.pickEdge(scene.x, scene.y)
    if (edgeId) {
      useOmniStore.getState().selectEdge(edgeId)
      return
    }
    useOmniStore.getState().clearSelection()
  }
}

function snapToGrid(x: number, y: number, step: number): { x: number; y: number } {
  if (step <= 0) return { x, y }
  return {
    x: Math.round(x / step) * step,
    y: Math.round(y / step) * step,
  }
}

// Suppress unused import warning when the codebase later wires Pixi ghost lines.
void DRAG_TICKER_TAG
void Graphics
