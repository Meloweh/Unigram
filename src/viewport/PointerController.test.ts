import { describe, expect, it } from 'vitest'
import { resizeGeometryFromDrag, snapNodeCornerToGrid } from './PointerController'

describe('PointerController geometry helpers', () => {
  it('preserves corner-aware grid snapping', () => {
    expect(snapNodeCornerToGrid(10.4, 11.2, 5, 3, 4)).toEqual({ x: 10.5, y: 9.5 })
    expect(snapNodeCornerToGrid(10.4, 11.2, 5, 3, 0)).toEqual({ x: 10.4, y: 11.2 })
  })

  it('resizes from the dragged handle while keeping the opposite side pinned', () => {
    expect(resizeGeometryFromDrag({ x: 10, y: 10, w: 4, h: 6 }, 'se', 2, 3)).toEqual({
      x: 11,
      y: 11.5,
      w: 6,
      h: 9,
    })
    expect(resizeGeometryFromDrag({ x: 10, y: 10, w: 4, h: 6 }, 'nw', 1, 2)).toEqual({
      x: 10.5,
      y: 11,
      w: 3,
      h: 4,
    })
  })

  it('clamps resize handles to a minimum size', () => {
    expect(resizeGeometryFromDrag({ x: 10, y: 10, w: 4, h: 4 }, 'w', 20, 0)).toEqual({
      x: 11.5,
      y: 10,
      w: 1,
      h: 4,
    })
  })
})
