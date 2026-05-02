import { describe, expect, it, beforeEach } from 'vitest'
import { Container } from 'pixi.js'
import { EdgePool } from './EdgePool'
import type { Connection, ModelNode } from '../model/types'

function node(id: string, x: number, y: number, w = 8, h = 4): ModelNode {
  return {
    id,
    x,
    y,
    w,
    h,
    label: '',
    shape: 'rounded-rect',
    cellColor: '#ffffff',
    membraneColor: '#000000',
  }
}

function edge(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'e1',
    from: 'a',
    to: 'b',
    color: '#365f8f',
    width: 0.15,
    ...overrides,
  }
}

let layer: Container
let pool: EdgePool

beforeEach(() => {
  layer = new Container()
  pool = new EdgePool(layer)
})

describe('EdgePool parity styling', () => {
  it('acquires & releases an edge', () => {
    const a = node('a', 10, 10)
    const b = node('b', 30, 10)
    pool.acquire(edge(), a, b)
    expect(pool.activeCount).toBe(1)
    pool.release('e1')
    expect(pool.activeCount).toBe(0)
  })

  it('reuses the same Graphics across updates', () => {
    const a = node('a', 10, 10)
    const b = node('b', 30, 10)
    pool.acquire(edge(), a, b)
    const gfx = layer.children[0]
    pool.update(edge({ color: '#abcdef' }), a, b)
    expect(layer.children[0]).toBe(gfx)
  })

  it('supports kind=flow without crashing', () => {
    const a = node('a', 10, 10)
    const b = node('b', 30, 10)
    pool.acquire(edge({ kind: 'flow' }), a, b)
    expect(pool.activeCount).toBe(1)
  })

  it('handles every dash style', () => {
    const a = node('a', 10, 10)
    const b = node('b', 30, 10)
    for (const dash of ['solid', 'dashed', 'dotted', 'dash-dot'] as const) {
      pool.acquire(edge({ id: `e-${dash}`, dash }), a, b)
    }
    expect(pool.activeCount).toBe(4)
  })

  it('mounts a Text label only when label is set', () => {
    const a = node('a', 10, 10)
    const b = node('b', 30, 10)
    pool.acquire(edge(), a, b)
    expect(layer.children).toHaveLength(1)
    pool.acquire(edge({ id: 'e2', label: 'depends on' }), a, b)
    // 1 gfx (e1) + 1 gfx (e2) + 1 label (e2) = 3
    expect(layer.children).toHaveLength(3)
  })

  it('hides the label when text is cleared', () => {
    const a = node('a', 10, 10)
    const b = node('b', 30, 10)
    pool.acquire(edge({ label: 'hi' }), a, b)
    pool.update(edge({ label: '' }), a, b)
    const labels = layer.children.filter(c => 'text' in c)
    expect(labels.every(l => !l.visible)).toBe(true)
  })
})
