import { describe, expect, it } from 'vitest'
import { clientToScene, sceneToClient, visibleSceneAabb } from './sceneConstants'

const camera = { panX: 0, panY: 0, freeScale: 1 }
const viewport = { width: 1000, height: 600 }

describe('sceneConstants', () => {
  it('round-trips client ↔ scene at default camera', () => {
    const s = clientToScene(500, 300, camera, viewport)
    expect(s.x).toBeCloseTo(0, 6)
    expect(s.y).toBeCloseTo(0, 6)
    const c = sceneToClient(0, 0, camera, viewport)
    expect(c.x).toBeCloseTo(500, 6)
    expect(c.y).toBeCloseTo(300, 6)
  })

  it('round-trips with non-trivial pan and zoom', () => {
    const cam = { panX: 123.4, panY: -56.7, freeScale: 2.3 }
    const original = { x: 17.5, y: -8.25 }
    const c = sceneToClient(original.x, original.y, cam, viewport)
    const back = clientToScene(c.x, c.y, cam, viewport)
    expect(back.x).toBeCloseTo(original.x, 4)
    expect(back.y).toBeCloseTo(original.y, 4)
  })

  it('visibleSceneAabb spans the viewport corners', () => {
    const a = visibleSceneAabb(camera, viewport, 0)
    const tl = clientToScene(0, 0, camera, viewport)
    const br = clientToScene(viewport.width, viewport.height, camera, viewport)
    expect(a.minX).toBeCloseTo(tl.x)
    expect(a.minY).toBeCloseTo(tl.y)
    expect(a.maxX).toBeCloseTo(br.x)
    expect(a.maxY).toBeCloseTo(br.y)
  })

  it('padding expands the visible aabb symmetrically', () => {
    const a = visibleSceneAabb(camera, viewport, 5)
    const b = visibleSceneAabb(camera, viewport, 0)
    expect(a.minX).toBeCloseTo(b.minX - 5)
    expect(a.maxX).toBeCloseTo(b.maxX + 5)
  })
})
