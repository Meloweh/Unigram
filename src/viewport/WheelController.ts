/**
 * WheelController — free-zoom only at stage 1. Anchors zoom around the cursor
 * so the scene point under the cursor stays put. RMM hybrid zoom is stage 3.
 */

import {
  clientToScene,
  FREE_ZOOM_MAX,
  FREE_ZOOM_MIN,
  type CameraTransform,
} from '../scene/sceneConstants'
import type { SceneRenderer } from '../scene/SceneRenderer'

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
    const cam = this.renderer.getCamera()
    const factor = e.deltaY < 0 ? ZOOM_PER_NOTCH : 1 / ZOOM_PER_NOTCH
    const nextScale = clamp(cam.freeScale * factor, FREE_ZOOM_MIN, FREE_ZOOM_MAX)
    if (nextScale === cam.freeScale) return
    const rect = this.host.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const vp = this.renderer.getViewport()
    // Anchor: the scene point under the cursor before and after must match.
    const before = clientToScene(cx, cy, cam, vp)
    const tentative: CameraTransform = { ...cam, freeScale: nextScale }
    const after = clientToScene(cx, cy, tentative, vp)
    const next: CameraTransform = {
      panX: cam.panX + (after.x - before.x) * (1920 / 100),
      panY: cam.panY + (after.y - before.y) * (1080 / 100),
      freeScale: nextScale,
    }
    this.renderer.setCamera(next)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
