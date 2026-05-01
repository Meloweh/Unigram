import type { ModelNode } from '../model/sampleModels'

/** Build an O(1) node lookup map by ID */
export function buildNodeMap(nodes: readonly ModelNode[]): Map<string, ModelNode> {
  return new Map(nodes.map(n => [n.id, n]))
}
