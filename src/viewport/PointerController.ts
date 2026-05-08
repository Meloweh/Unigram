/**
 * PointerController — wires browser pointer events on the host element to
 * scene-level interactions:
 *   - left-drag empty: pan (writes camera directly to renderer; commits to
 *     store on pointerup).
 *   - left-drag node: move (writes node position directly via renderer pool;
 *     commits to store on pointerup).
 *   - click empty: clear selection.
 *   - click node: single-select.
 *   - right-drag node: draft connection (renderer-only ghost line); commits
 *     on pointerup if dropped on another node.
 *
 * The controller never touches React. It pulls the model/store lazily from a
 * supplied accessor so it doesn't capture a stale snapshot.
 */

import { Graphics } from 'pixi.js'
import { clientToScene } from '../scene/sceneConstants'
import type { ResizeHandleDir, SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore } from '../model/store'
import { getSocialEdgeDraftCount, registerSocialEdgeDraft } from '../social/graphDraft'
import { getTransformDraftCount, markTransformDraftTouched } from '../social/transformDraft'

interface ActiveDrag {
  kind: 'pan' | 'node' | 'connect' | 'box' | 'tip' | 'resize'
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
  /** Snapshot of edge selection at gesture start (for additive box-select). */
  baseEdgeSelection?: ReadonlySet<string>
  totalMoved?: number
  tipBaseline?: { id: string; tipAngle?: number; tipLength?: number; tip?: import('../model/types').ModelNode['tip'] }
  resizeDir?: ResizeHandleDir
  resizeBaseline?: { id: string; x: number; y: number; w: number; h: number }
}

const CLICK_THRESHOLD_PX = 4
const DOUBLE_CLICK_MS = 300
const DRAG_TICKER_TAG = 'omni-pointer'

export interface PointerControllerOptions {
  snap?: number
}

export class PointerController {
  private active: ActiveDrag | null = null
  private readonly dragMovesScratch: Array<{ id: string; x: number; y: number }> = []
  private pendingNodeDrag: { baselines: Array<{ id: string; x: number; y: number }>; dx: number; dy: number } | null = null
  private nodeDragRaf = 0
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
    if (this.nodeDragRaf) cancelAnimationFrame(this.nodeDragRaf)
    this.nodeDragRaf = 0
    this.pendingNodeDrag = null
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
    const resizeHit = e.button === 0 ? this.renderer.pickResizeHandle(scene.x, scene.y) : null
    const tipHitId = e.button === 0 && !resizeHit ? this.renderer.pickCosmeticTipHandle(scene.x, scene.y) : null
    const hitId = this.renderer.pickNode(scene.x, scene.y)
    const isRight = e.button === 2
    const shift = e.shiftKey
    this.host.setPointerCapture(e.pointerId)

    if (resizeHit) {
      const node = useOmniStore.getState().model.nodes.get(resizeHit.id)
      if (!node || node.locked) return
      if (getSocialEdgeDraftCount() > 0) return
      this.active = {
        kind: 'resize',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        nodeId: resizeHit.id,
        resizeDir: resizeHit.dir,
        resizeBaseline: { id: resizeHit.id, x: node.x, y: node.y, w: node.w, h: node.h },
        totalMoved: 0,
      }
      return
    }

    if (tipHitId) {
      const node = useOmniStore.getState().model.nodes.get(tipHitId)
      if (!node || node.locked) return
      this.active = {
        kind: 'tip',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startScene: scene,
        nodeId: tipHitId,
        tipBaseline: { id: tipHitId, tipAngle: node.tipAngle, tipLength: node.tipLength, tip: node.tip },
        totalMoved: 0,
      }
      return
    }

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
        baseEdgeSelection: new Set(useOmniStore.getState().selectedEdgeIds),
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
      // One-shot pick mode — used by the inspector "Link to node…" button.
      // The previously-selected node becomes the link source; this hit is
      // the peer. Pick mode auto-clears regardless of outcome.
      if (store.pickMode === 'link-node') {
        const source = store.selectedIds.size === 1
          ? (store.selectedIds.values().next().value as string)
          : null
        store.setPickMode(null)
        if (source && source !== hitId) {
          store.linkNodes(source, hitId)
          // Restore the source as the active selection so the inspector
          // shows the new link immediately.
          store.select(source, false)
          return
        }
      }
      // Selection rules:
      //   shift + click → toggle membership in current selection
      //   click on already-selected node → keep selection (start multi-drag)
      //   click on unselected node → replace selection with just this id
      if (shift) {
        store.select(hitId, true)
      } else if (!store.selectedIds.has(hitId)) {
        store.select(hitId, false)
      }
      if (getSocialEdgeDraftCount() > 0) return
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
      // Pointer events can arrive faster than Pixi renders. Coalesce large
      // multi-selection drags to one renderer write per animation frame.
      this.pendingNodeDrag = { baselines: a.dragBaselines, dx, dy }
      if (!this.nodeDragRaf) {
        this.nodeDragRaf = requestAnimationFrame(() => {
          this.nodeDragRaf = 0
          this.flushNodeDrag()
        })
      }
      return
    }

    if (a.kind === 'resize' && a.resizeBaseline && a.resizeDir) {
      const sceneNow = this.toScene(e)
      const dx = sceneNow.x - a.startScene.x
      const dy = sceneNow.y - a.startScene.y
      this.renderer.resizeNodeDirect(
        a.resizeBaseline.id,
        resizeGeometryFromDrag(a.resizeBaseline, a.resizeDir, dx, dy),
      )
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

    if (a.kind === 'tip' && a.nodeId) {
      const sceneNow = this.toScene(e)
      this.renderer.moveCosmeticTipDirect(a.nodeId, sceneNow.x, sceneNow.y)
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
    this.flushNodeDrag()
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
        // anchor so the relative offsets are preserved. We snap the
        // anchor's top-left corner to the grid ("corner-to-corner")
        // because users align node edges, not centres, against grid lines.
        const store = useOmniStore.getState()
        const anchor = a.dragBaselines[0]
        const cur = store.model.nodes.get(anchor.id)
        if (cur) {
          const snapped = snapNodeCornerToGrid(cur.x, cur.y, cur.w, cur.h, this.snapStep)
          const sx = snapped.x - cur.x
          const sy = snapped.y - cur.y
          if (sx !== 0 || sy !== 0) {
            const moves = this.dragMovesScratch
            moves.length = 0
            for (let i = 0; i < a.dragBaselines.length; i++) {
              const b = a.dragBaselines[i]
              const live = store.model.nodes.get(b.id)
              if (!live) continue
              moves.push({ id: b.id, x: live.x + sx, y: live.y + sy })
            }
            this.renderer.moveNodesDirect(moves, { updateIndex: false })
          }
        }
        this.renderer.reindexNodes(a.dragBaselines.map((b) => b.id))
        store.commitDrag(a.dragBaselines)
        markTransformDraftTouched(store.model.id, a.dragBaselines.map((b) => b.id))
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

    if (a.kind === 'resize' && a.resizeBaseline) {
      if (movedFar) {
        const store = useOmniStore.getState()
        const cur = store.model.nodes.get(a.resizeBaseline.id)
        if (cur) {
          const snapped = snapNodeCornerToGrid(cur.x, cur.y, cur.w, cur.h, this.snapStep)
          if (snapped.x !== cur.x || snapped.y !== cur.y) {
            this.renderer.resizeNodeDirect(cur.id, { x: snapped.x, y: snapped.y, w: cur.w, h: cur.h })
          }
        }
        store.commitGeometry(a.resizeBaseline)
        markTransformDraftTouched(store.model.id, [a.resizeBaseline.id])
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
      const nodeHits: string[] = []
      const edgeHits: string[] = []
      this.renderer.queryAabb(aabb, nodeHits)
      this.renderer.queryEdgesAabb(aabb, edgeHits)
      const nextNodes = a.additive && a.baseSelection ? new Set(a.baseSelection) : new Set<string>()
      const nextEdges = a.additive && a.baseEdgeSelection ? new Set(a.baseEdgeSelection) : new Set<string>()
      for (let i = 0; i < nodeHits.length; i++) nextNodes.add(nodeHits[i])
      const model = useOmniStore.getState().model
      for (let i = 0; i < edgeHits.length; i++) {
        const edge = model.edges.get(edgeHits[i])
        if (edge && nextNodes.has(edge.from) && nextNodes.has(edge.to)) continue
        nextEdges.add(edgeHits[i])
      }
      useOmniStore.getState().selectMany(nextNodes, nextEdges)
      return
    }

    if (a.kind === 'tip' && a.tipBaseline) {
      useOmniStore.getState().commitCosmeticTip(a.tipBaseline)
      return
    }

    if (a.kind === 'connect' && a.nodeId) {
      this.renderer.setConnectGhost(null, null)
      const drop = this.toScene(e)
      const targetId = this.renderer.pickNode(drop.x, drop.y)
      if (targetId && targetId !== a.nodeId) {
        if (getSocialEdgeDraftCount() > 0 || getTransformDraftCount(useOmniStore.getState().model.id) > 0) return
        const kind = useOmniStore.getState().defaultConnectionKind
        const edgeId = useOmniStore.getState().addEdge(a.nodeId, targetId, { kind, extra: { socialDraft: true } })
        const edge = edgeId ? useOmniStore.getState().model.edges.get(edgeId) : null
        if (edge) registerSocialEdgeDraft(edge)
      }
      a.ghost?.destroy()
      return
    }
  }

  private flushNodeDrag(): void {
    const pending = this.pendingNodeDrag
    if (!pending) return
    this.pendingNodeDrag = null
    const moves = this.dragMovesScratch
    moves.length = 0
    for (let i = 0; i < pending.baselines.length; i++) {
      const b = pending.baselines[i]
      moves.push({ id: b.id, x: b.x + pending.dx, y: b.y + pending.dy })
    }
    this.renderer.moveNodesDirect(moves, { updateIndex: false })
  }

  private handleEmptyClick(e: PointerEvent, scene: { x: number; y: number }): void {
    // Empty-space click — try an edge hit before clearing selection.
    const edgeId = this.renderer.pickEdge(scene.x, scene.y)
    if (edgeId) {
      useOmniStore.getState().selectEdge(edgeId, e.shiftKey)
      return
    }
    useOmniStore.getState().clearSelection()
  }
}

/**
 * Corner-to-corner snap: nodes carry their position as the centre, but
 * users align edges against grid lines. We snap the *top-left corner*
 * (`x - w/2`, `y - h/2`) to the nearest grid intersection, then convert
 * back to centre coords. Returns the new centre.
 */
export function snapNodeCornerToGrid(
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
): { x: number; y: number } {
  if (step <= 0) return { x, y }
  const cornerX = x - w / 2
  const cornerY = y - h / 2
  const snappedCornerX = Math.round(cornerX / step) * step
  const snappedCornerY = Math.round(cornerY / step) * step
  return { x: snappedCornerX + w / 2, y: snappedCornerY + h / 2 }
}

export function resizeGeometryFromDrag(
  baseline: { x: number; y: number; w: number; h: number },
  dir: ResizeHandleDir,
  dx: number,
  dy: number,
): { x: number; y: number; w: number; h: number } {
  const minW = 1
  const minH = 1
  let left = baseline.x - baseline.w / 2
  let right = baseline.x + baseline.w / 2
  let top = baseline.y - baseline.h / 2
  let bottom = baseline.y + baseline.h / 2
  if (dir.includes('e')) right += dx
  if (dir.includes('w')) left += dx
  if (dir.includes('s')) bottom += dy
  if (dir.includes('n')) top += dy
  if (right - left < minW) {
    if (dir.includes('w')) left = right - minW
    else right = left + minW
  }
  if (bottom - top < minH) {
    if (dir.includes('n')) top = bottom - minH
    else bottom = top + minH
  }
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    w: right - left,
    h: bottom - top,
  }
}

// Suppress unused import warning when the codebase later wires Pixi ghost lines.
void DRAG_TICKER_TAG
void Graphics
