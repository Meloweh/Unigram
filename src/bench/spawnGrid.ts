/**
 * Bench scenarios. Each spawnXxx returns a Model populated with deterministic
 * geometry so benchmarks are reproducible. Centered around scene (0,0).
 */

import { DEFAULT_EDGE, DEFAULT_NODE, type Connection, type Model, type ModelNode } from '../model/types'

export interface SpawnGridOptions {
  count?: number
  spacingPercent?: number
  edgeRatio?: number
  seed?: number
}

export function spawnGrid(opts: SpawnGridOptions = {}): Model {
  const count = opts.count ?? 2000
  const spacing = opts.spacingPercent ?? 6
  const edgeRatio = opts.edgeRatio ?? 1.5
  const seed = opts.seed ?? 0xc0ffee
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
