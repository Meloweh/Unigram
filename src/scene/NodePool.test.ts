import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Container } from 'pixi.js'
import type { ModelNode } from '../model/types'
import type { NodeOverride } from '../flow/types'

vi.mock('./nodeStyle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nodeStyle')>()
  return { ...actual, nodeFillGradient: () => '#ffffff' }
})

const { NodePool } = await import('./NodePool')

function node(overrides: Partial<ModelNode> = {}): ModelNode {
  return {
    id: 'n1',
    x: 10,
    y: 10,
    w: 5.1,
    h: 5,
    label: 'node',
    shape: 'rounded-rect',
    cellColor: '#ffffff',
    membraneColor: '#0f172a',
    ...overrides,
  }
}

let layer: Container
let pool: NodePool

beforeEach(() => {
  layer = new Container()
  pool = new NodePool(layer)
})

describe('NodePool lazy visual subtrees', () => {
  it('keeps a plain node to shape + label only', () => {
    pool.acquire(node(), 'full')

    expect(pool.activeCount).toBe(1)
    const container = layer.children[0] as Container
    expect(container.children).toHaveLength(2)
  })

  it('can keep labels visible when shapes drop to simple LOD', () => {
    pool.acquire(node(), 'simple', undefined, true)

    const container = layer.children[0] as Container
    const label = container.children[1]
    expect(label.visible).toBe(true)
  })

  it('hides labels in simple LOD once the renderer disables them', () => {
    pool.acquire(node(), 'simple', undefined, false)

    const container = layer.children[0] as Container
    const label = container.children[1]
    expect(label.visible).toBe(false)
  })

  it('creates media preview children only for media nodes', () => {
    pool.acquire(node(), 'full')
    const container = layer.children[0] as Container
    expect(container.children).toHaveLength(2)

    pool.update(node({ mediaType: 'markdown', contentSource: 'preview' }), 'full')
    expect(container.children).toHaveLength(5)
  })

  it('creates break-apart children only while breaking', () => {
    pool.acquire(node(), 'full')
    const container = layer.children[0] as Container
    expect(container.children).toHaveLength(2)

    const override: NodeOverride = {
      breakApart: { axis: 'vertical', shakeX: 1, shakeY: 2, fallRatio: 0.25 },
    }
    pool.update(node(), 'full', override)
    expect(container.children).toHaveLength(3)
  })
})
