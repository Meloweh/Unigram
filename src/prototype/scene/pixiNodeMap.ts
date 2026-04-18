/**
 * Global nodeId → PixiJS Container lookup.
 *
 * Shared between scene rendering, flow engine, and cosmetic animations
 * so they can address PixiJS display objects without DOM queries.
 */
import type { Container } from 'pixi.js'

const _map = new Map<string, Container>()

export const pixiNodeMap = {
  get(id: string): Container | undefined { return _map.get(id) },
  set(id: string, c: Container): void { _map.set(id, c) },
  delete(id: string): boolean { return _map.delete(id) },
  has(id: string): boolean { return _map.has(id) },
  clear(): void { _map.clear() },
  get size(): number { return _map.size },
  values(): IterableIterator<Container> { return _map.values() },
  entries(): IterableIterator<[string, Container]> { return _map.entries() },
}
