import { describe, expect, it } from 'vitest'
import { Quadtree } from './quadtree'

const aabb = (minX: number, minY: number, w: number, h: number) => ({
  minX,
  minY,
  maxX: minX + w,
  maxY: minY + h,
})

describe('Quadtree', () => {
  it('returns no results for an empty tree', () => {
    const qt = new Quadtree()
    expect(qt.query(aabb(0, 0, 100, 100))).toEqual([])
    expect(qt.pick(50, 50)).toEqual([])
    expect(qt.size).toBe(0)
  })

  it('inserts and retrieves a single entity', () => {
    const qt = new Quadtree()
    qt.insert('a', aabb(10, 10, 5, 5))
    expect(qt.size).toBe(1)
    expect(qt.query(aabb(0, 0, 50, 50))).toEqual(['a'])
    expect(qt.pick(12, 12)).toEqual(['a'])
    expect(qt.pick(0, 0)).toEqual([])
  })

  it('subdivides past bucket size and still returns all hits', () => {
    const qt = new Quadtree()
    for (let i = 0; i < 50; i++) {
      qt.insert(`n${i}`, aabb(i, i, 0.5, 0.5))
    }
    const hits = qt.query(aabb(-1, -1, 200, 200))
    expect(hits).toHaveLength(50)
    expect(new Set(hits).size).toBe(50)
  })

  it('finds entities straddling a quadrant boundary', () => {
    const qt = new Quadtree()
    // Force subdivision then add one straddler.
    for (let i = 0; i < 20; i++) qt.insert(`f${i}`, aabb(i, 0, 0.1, 0.1))
    qt.insert('straddle', aabb(48, 48, 4, 4))
    expect(qt.pick(50, 50)).toContain('straddle')
    expect(qt.query(aabb(49, 49, 1, 1))).toContain('straddle')
  })

  it('removes entities cleanly', () => {
    const qt = new Quadtree()
    qt.insert('a', aabb(10, 10, 5, 5))
    qt.insert('b', aabb(20, 20, 5, 5))
    qt.remove('a')
    expect(qt.size).toBe(1)
    expect(qt.pick(12, 12)).toEqual([])
    expect(qt.pick(22, 22)).toEqual(['b'])
  })

  it('update relocates the entity', () => {
    const qt = new Quadtree()
    qt.insert('m', aabb(5, 5, 2, 2))
    qt.update('m', aabb(80, 80, 2, 2))
    expect(qt.pick(6, 6)).toEqual([])
    expect(qt.pick(81, 81)).toEqual(['m'])
    expect(qt.size).toBe(1)
  })

  it('reuses the caller-supplied output buffer (no allocation)', () => {
    const qt = new Quadtree()
    qt.insert('x', aabb(0, 0, 1, 1))
    const buf: string[] = []
    const ret = qt.query(aabb(-1, -1, 5, 5), buf)
    expect(ret).toBe(buf)
    expect(buf).toEqual(['x'])
  })

  it('clear empties the tree', () => {
    const qt = new Quadtree()
    qt.insert('a', aabb(1, 1, 1, 1))
    qt.clear()
    expect(qt.size).toBe(0)
    expect(qt.query(aabb(0, 0, 100, 100))).toEqual([])
  })
})
