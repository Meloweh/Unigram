/**
 * pixiViewportState — module-level mutable state written by React,
 * read by the PixiJS ticker for viewport culling.
 *
 * This decouples the PixiJS rendering loop from React re-renders:
 * React writes the latest visibleRect on every frame, and the
 * PixiJS ticker reads it to toggle container visibility.
 */
import { SCENE_W, SCENE_H } from './sceneConstants'

export interface VisibleRect {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Visible rect in %-of-scene coords (0-100 range with buffer) */
let _rect: VisibleRect = { minX: -999, maxX: 999, minY: -999, maxY: 999 }

export function setPixiVisibleRect(r: VisibleRect) { _rect = r }
export function getPixiVisibleRect(): VisibleRect { return _rect }

/** Convert %-rect to scene-pixel bounds (used by node/connection culling) */
export function getPixiVisibleRectPx() {
  return {
    minX: _rect.minX / 100 * SCENE_W,
    maxX: _rect.maxX / 100 * SCENE_W,
    minY: _rect.minY / 100 * SCENE_H,
    maxY: _rect.maxY / 100 * SCENE_H,
  }
}
