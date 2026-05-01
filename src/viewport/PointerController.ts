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
import { clientToScene, DEFAULT_GRID_SNAP } from '../scene/sceneConstants'
import type { SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore } from '../model/store'

interface ActiveDrag {
  kind: 'pan' | 'node' | 'connect'
  pointerId: number
  startClient: { x: number; y: number }
  startScene: { x: number; y: number }
  // For 'node':
  nodeId?: string
  startNodeXY?: { x: number; y: number }
  // For 'pan':
  startCamera?: { panX: number; panY: number }
  // For 'connect':
  ghost?: Graphics
  hoverTargetId?: string | null
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
  private snap: number
  private readonly host: HTMLElement
  private readonly renderer: SceneRenderer

  constructor(
    host: HTMLElement,
    renderer: SceneRenderer,
    options: PointerControllerOptions = {},
  ) {
    this.host = host
    this.renderer = renderer
    this.snap = options.snap ?? DEFAULT_GRID_SNAP
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

    if (e.button === 0 && hitId) {
      const node = useOmniStore.getState().model.nodes.get(hitId)
      if (!node) return
      // Single-select on press; full select-on-up if it turns into a click.
      if (!useOmniStore.getState().selectedIds.has(hitId)) {
        useOmniStore.getState().select(hitId)
      }
      this.active = {
        kind: 'node',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        nodeId: hitId,
        startNodeXY: { x: node.x, y: node.y },
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

    if (a.kind === 'node' && a.nodeId && a.startNodeXY) {
      const sceneNow = this.toScene(e)
      const sceneStart = a.startScene
      // Update store directly; renderer will re-render on next dirty cycle.
      // Per-frame store writes are acceptable at stage 1 because moveNodes
      // diff suppresses no-ops and patches are tiny. Stage 2 will move this
      // to a renderer-direct path.
      useOmniStore.getState().moveNodes([
        {
          id: a.nodeId,
          x: a.startNodeXY.x + (sceneNow.x - sceneStart.x),
          y: a.startNodeXY.y + (sceneNow.y - sceneStart.y),
        },
      ])
      return
    }

    if (a.kind === 'connect' && a.nodeId) {
      const sceneNow = this.toScene(e)
      const hoverId = this.renderer.pickNode(sceneNow.x, sceneNow.y)
      a.hoverTargetId = hoverId && hoverId !== a.nodeId ? hoverId : null
      // Visual feedback for the draft connection is intentionally minimal at
      // stage 1; full ghost rendering arrives with edge anchoring in stage 3.
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

    if (a.kind === 'node' && a.nodeId && a.startNodeXY) {
      if (movedFar) {
        // Snap on commit.
        const cur = useOmniStore.getState().model.nodes.get(a.nodeId)
        if (cur) {
          const snapped = snapToGrid(cur.x, cur.y, this.snap)
          if (snapped.x !== cur.x || snapped.y !== cur.y) {
            useOmniStore.getState().moveNodes([{ id: a.nodeId, x: snapped.x, y: snapped.y }])
          }
        }
      }
      return
    }

    if (a.kind === 'connect' && a.nodeId) {
      const drop = this.toScene(e)
      const targetId = this.renderer.pickNode(drop.x, drop.y)
      if (targetId && targetId !== a.nodeId) {
        useOmniStore.getState().addEdge(a.nodeId, targetId)
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
      const snapped = snapToGrid(scene.x, scene.y, this.snap)
      const id = useOmniStore.getState().addNode({
        x: snapped.x,
        y: snapped.y,
        label: 'node',
      })
      useOmniStore.getState().select(id)
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
