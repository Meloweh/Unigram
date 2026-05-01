/**
 * WheelController — routes wheel input.
 *
 * - With a single selected node that has a `childModelId` *or* with an RMM
 *   transition already in progress: drives the hybrid recursive-model zoom
 *   via `rmmZoomStep`. Camera composition (RMM cameraScale × free zoom) is
 *   applied by the scene bridge so this handler stays free of math.
 * - Otherwise: free zoom anchored on the cursor (stage-1 behaviour).
 */

import {
  clientToScene,
  FREE_ZOOM_MAX,
  FREE_ZOOM_MIN,
  type CameraTransform,
} from '../scene/sceneConstants'
import type { SceneRenderer } from '../scene/SceneRenderer'
import { useOmniStore } from '../model/store'
import { isAtRest } from '../zoom/hybridZoom'

const ZOOM_PER_NOTCH = 1.1

export class WheelController {
  private readonly host: HTMLElement
  private readonly renderer: SceneRenderer

  constructor(host: HTMLElement, renderer: SceneRenderer) {
    this.host = host
    this.renderer = renderer
    host.addEventListener('wheel', this.onWheel, { passive: false })
  }

  destroy(): void {
    this.host.removeEventListener('wheel', this.onWheel)
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const store = useOmniStore.getState()
    const direction: 'in' | 'out' = e.deltaY < 0 ? 'in' : 'out'

    // RMM is active if a transition is mid-flight, or if zooming-in on a
    // single selected node that exposes a child model.
    const transitionActive = !isAtRest(store.zoom) || store.focusedNodeId != null
    const canStartRmm =
      direction === 'in' &&
      store.selectedIds.size === 1 &&
      (() => {
        const id = store.selectedIds.values().next().value as string
        return store.model.nodes.get(id)?.childModelId != null
      })()
    const canPopStack = direction === 'out' && store.zoomStack.length > 0

    if (transitionActive || canStartRmm || canPopStack) {
      store.rmmZoomStep(direction)
      return
    }

    const cam = this.renderer.getCamera()
    const factor = direction === 'in' ? ZOOM_PER_NOTCH : 1 / ZOOM_PER_NOTCH
    const nextScale = clamp(cam.freeScale * factor, FREE_ZOOM_MIN, FREE_ZOOM_MAX)
    if (nextScale === cam.freeScale) return
    const rect = this.host.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const vp = this.renderer.getViewport()
    const before = clientToScene(cx, cy, cam, vp)
    const tentative: CameraTransform = { ...cam, freeScale: nextScale }
    const after = clientToScene(cx, cy, tentative, vp)
    const next: CameraTransform = {
      panX: cam.panX + (after.x - before.x) * (1920 / 100),
      panY: cam.panY + (after.y - before.y) * (1080 / 100),
      freeScale: nextScale,
    }
    // Persist to store so the bridge & sidebar see it; renderer is updated
    // inside the camera subscription on the bridge.
    useOmniStore.getState().setCamera(next)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
