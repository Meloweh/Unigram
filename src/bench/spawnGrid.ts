/**
 * Bench scenarios. Each spawnXxx returns a Model populated with deterministic
 * geometry so benchmarks are reproducible. Centered around scene (0,0).
 */

import { DEFAULT_EDGE, DEFAULT_NODE, type Connection, type Model, type ModelNode, type NodeShape } from '../model/types'

export interface SpawnGridOptions {
  count?: number
  spacingPercent?: number
  edgeRatio?: number
  seed?: number
  /** When true, cycles through all 10 shapes for visual variety. */
  mixedShapes?: boolean
}

const ALL_SHAPES: NodeShape[] = [
  'rectangle',
  'rounded-rect',
  'circle',
  'oval',
  'diamond',
  'hexagon',
  'parallelogram',
  'triangle',
  'chat-bubble',
  'thinking-cloud',
]

export function spawnGrid(opts: SpawnGridOptions = {}): Model {
  const count = opts.count ?? 2000
  const spacing = opts.spacingPercent ?? 6
  const edgeRatio = opts.edgeRatio ?? 1.5
  const seed = opts.seed ?? 0xc0ffee
  const mixed = opts.mixedShapes ?? false
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const nodes = new Map<string, ModelNode>()
  const ids: string[] = []
  let i = 0
  for (let r = 0; r < rows && i < count; r++) {
    for (let c = 0; c < cols && i < count; c++, i++) {
      const id = `n${i}`
      const x = (c - (cols - 1) / 2) * spacing
      const y = (r - (rows - 1) / 2) * spacing
      const node: ModelNode = {
        ...DEFAULT_NODE,
        id,
        x,
        y,
        label: `n${i}`,
        shape: mixed ? ALL_SHAPES[i % ALL_SHAPES.length] : DEFAULT_NODE.shape,
      }
      nodes.set(id, node)
      ids.push(id)
    }
  }
  const edges = new Map<string, Connection>()
  const edgeCount = Math.floor(count * edgeRatio)
  const rng = mulberry32(seed)
  for (let k = 0; k < edgeCount; k++) {
    const fi = Math.floor(rng() * ids.length)
    let ti = Math.floor(rng() * ids.length)
    if (ti === fi) ti = (ti + 1) % ids.length
    const id = `e${k}`
    edges.set(id, { ...DEFAULT_EDGE, id, from: ids[fi], to: ids[ti] })
  }
  return { id: 'bench-grid', name: 'Grid Benchmark', nodes, edges }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Build a small parent model whose nodes link to procedurally-generated
 * child models. Returns `{ root, children }` so the caller can register the
 * children with the store before activating the root. Used for the RMM demo
 * — Spawn Nested in the toolbar.
 */
export function spawnNested(): { root: Model; children: Model[] } {
  const childCount = 4
  const children: Model[] = []
  for (let i = 0; i < childCount; i++) {
    children.push(spawnGrid({
      count: 12 + i * 6,
      spacingPercent: 8,
      edgeRatio: 1.2,
      seed: 0xa11ce + i,
      mixedShapes: true,
    }))
    // Re-id so each child has a distinct id.
    children[i] = { ...children[i], id: `child-${i}`, name: `Child ${i + 1}` }
  }
  const nodes = new Map<string, ModelNode>()
  const edges = new Map<string, Connection>()
  for (let i = 0; i < childCount; i++) {
    const angle = (i / childCount) * Math.PI * 2
    const x = Math.cos(angle) * 22
    const y = Math.sin(angle) * 14
    const id = `parent-${i}`
    nodes.set(id, {
      ...DEFAULT_NODE,
      id,
      x,
      y,
      w: 14,
      h: 10,
      label: `Open ${i + 1}`,
      shape: 'rounded-rect',
      cellColor: '#f4faff',
      membraneColor: '#2b6cb0',
      childModelId: children[i].id,
    })
  }
  // A few cosmetic peripheral nodes without children.
  for (let i = 0; i < 3; i++) {
    const id = `note-${i}`
    nodes.set(id, {
      ...DEFAULT_NODE,
      id,
      x: -30 + i * 30,
      y: 26,
      w: 8,
      h: 5,
      label: `note ${i}`,
      shape: 'chat-bubble',
      cellColor: '#fffbf0',
      membraneColor: '#a07a30',
    })
  }
  // Star edges between parent nodes.
  let k = 0
  for (let i = 0; i < childCount; i++) {
    for (let j = i + 1; j < childCount; j++) {
      const id = `pe${k++}`
      edges.set(id, { ...DEFAULT_EDGE, id, from: `parent-${i}`, to: `parent-${j}` })
    }
  }
  const root: Model = { id: 'nested-root', name: 'Nested Demo', nodes, edges }
  return { root, children }
}
