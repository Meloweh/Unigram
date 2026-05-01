/**
 * Allocation-free quadtree for stage-1 viewport culling and hit-testing.
 *
 * Coordinates are scene percent (0–100). Entities are AABBs keyed by string id.
 * `query` and `pick` reuse a single internal result buffer and copy into the
 * caller's output array — hot paths must call them with a pre-allocated array
 * to avoid per-frame GC pressure.
 */

export interface Aabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Entry {
  id: string
  aabb: Aabb
}

interface Node {
  bounds: Aabb
  depth: number
  entries: Entry[]
  /** [TL, TR, BL, BR] or null while leaf. */
  children: [Node, Node, Node, Node] | null
}

const BUCKET_SIZE = 8
const MAX_DEPTH = 8

function makeNode(bounds: Aabb, depth: number): Node {
  return { bounds, depth, entries: [], children: null }
}

function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function aabbContainsPoint(a: Aabb, x: number, y: number): boolean {
  return x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY
}

function subdivide(node: Node): void {
  const { minX, minY, maxX, maxY } = node.bounds
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const d = node.depth + 1
  node.children = [
    makeNode({ minX, minY, maxX: midX, maxY: midY }, d),
    makeNode({ minX: midX, minY, maxX, maxY: midY }, d),
    makeNode({ minX, minY: midY, maxX: midX, maxY }, d),
    makeNode({ minX: midX, minY: midY, maxX, maxY }, d),
  ]
  // Re-distribute existing entries into children where they fit fully.
  const remaining: Entry[] = []
  for (const e of node.entries) {
    const child = childContaining(node, e.aabb)
    if (child) child.entries.push(e)
    else remaining.push(e)
  }
  node.entries = remaining
}

function childContaining(node: Node, aabb: Aabb): Node | null {
  if (!node.children) return null
  for (const c of node.children) {
    const b = c.bounds
    if (aabb.minX >= b.minX && aabb.maxX <= b.maxX && aabb.minY >= b.minY && aabb.maxY <= b.maxY) {
      return c
    }
  }
  return null
}

function insertInto(node: Node, entry: Entry): void {
  if (node.children) {
    const child = childContaining(node, entry.aabb)
    if (child) {
      insertInto(child, entry)
      return
    }
    node.entries.push(entry)
    return
  }
  node.entries.push(entry)
  if (node.entries.length > BUCKET_SIZE && node.depth < MAX_DEPTH) {
    subdivide(node)
  }
}

function collectInAabb(node: Node, area: Aabb, out: string[]): void {
  if (!aabbIntersects(node.bounds, area)) return
  for (const e of node.entries) {
    if (aabbIntersects(e.aabb, area)) out.push(e.id)
  }
  if (node.children) {
    collectInAabb(node.children[0], area, out)
    collectInAabb(node.children[1], area, out)
    collectInAabb(node.children[2], area, out)
    collectInAabb(node.children[3], area, out)
  }
}

function collectAtPoint(node: Node, x: number, y: number, out: string[]): void {
  if (!aabbContainsPoint(node.bounds, x, y)) return
  for (const e of node.entries) {
    if (aabbContainsPoint(e.aabb, x, y)) out.push(e.id)
  }
  if (node.children) {
    collectAtPoint(node.children[0], x, y, out)
    collectAtPoint(node.children[1], x, y, out)
    collectAtPoint(node.children[2], x, y, out)
    collectAtPoint(node.children[3], x, y, out)
  }
}

export class Quadtree {
  private root: Node
  private index = new Map<string, Entry>()

  constructor(bounds: Aabb = { minX: -200, minY: -200, maxX: 200, maxY: 200 }) {
    this.root = makeNode(bounds, 0)
  }

  get size(): number {
    return this.index.size
  }

  insert(id: string, aabb: Aabb): void {
    if (this.index.has(id)) this.remove(id)
    const entry: Entry = { id, aabb: { ...aabb } }
    this.index.set(id, entry)
    insertInto(this.root, entry)
  }

  has(id: string): boolean {
    return this.index.has(id)
  }

  /** Iterate all indexed ids. Iteration is cheap (Map.keys). */
  ids(): IterableIterator<string> {
    return this.index.keys()
  }

  remove(id: string): void {
    const entry = this.index.get(id)
    if (!entry) return
    this.index.delete(id)
    removeFrom(this.root, entry)
  }

  update(id: string, aabb: Aabb): void {
    const existing = this.index.get(id)
    if (existing) {
      const a = existing.aabb
      if (a.minX === aabb.minX && a.minY === aabb.minY && a.maxX === aabb.maxX && a.maxY === aabb.maxY) {
        return
      }
    }
    // Simple remove + re-insert. Cheap because tree is shallow.
    this.insert(id, aabb)
  }

  /** Append all entity ids whose AABB intersects `area` to `out`. */
  query(area: Aabb, out: string[] = []): string[] {
    out.length = 0
    collectInAabb(this.root, area, out)
    return out
  }

  /** Append all entity ids whose AABB contains the point to `out`. */
  pick(x: number, y: number, out: string[] = []): string[] {
    out.length = 0
    collectAtPoint(this.root, x, y, out)
    return out
  }

  clear(): void {
    this.index.clear()
    this.root = makeNode(this.root.bounds, 0)
  }
}

function removeFrom(node: Node, entry: Entry): boolean {
  const idx = node.entries.indexOf(entry)
  if (idx >= 0) {
    node.entries.splice(idx, 1)
    return true
  }
  if (!node.children) return false
  const child = childContaining(node, entry.aabb)
  if (child) return removeFrom(child, entry)
  for (const c of node.children) {
    if (removeFrom(c, entry)) return true
  }
  return false
}
