import { importBundle } from '../model/projectBundle'
import { useOmniStore } from '../model/store'
import type { Connection, Model, ModelNode } from '../model/types'
import { completeExternalRmmLink, normalizeExternalMpdLabel } from '../model/externalMpd'
import { getCloudDiagram } from '../social/cloudClient'

export async function ensureExternalRmmChild(nodeId: string): Promise<string | null> {
  const state = useOmniStore.getState()
  const node = state.model.nodes.get(nodeId)
  if (!node?.externalRmmLink) return node?.childModelId ?? null
  const link = completeExternalRmmLink(node.externalRmmLink)
  if (state.models.has(link.id)) return link.id
  const diagram = await getCloudDiagram(link.diagramId)
  if (!diagram.bundleBase64) return null
  const project = await importBundle(base64ToBlob(diagram.bundleBase64))
  const root = project.models.get(project.rootModelId)
  if (!root) return null
  const matched = link.targetNodeId
    ? root.nodes.get(link.targetNodeId) ?? findNodeByNormalizedLabel(root, link.nodeLabel)
    : findNodeByNormalizedLabel(root, link.nodeLabel)
  if (!matched) return null
  const model: Model = {
    ...root,
    id: link.id,
    name: diagram.title || link.diagramTitle,
    nodes: cloneNodeMap(root.nodes),
    edges: cloneEdgeMap(root.edges),
    ...(root.crossLinks ? { crossLinks: root.crossLinks.map((item) => ({ ...item, from: { ...item.from }, to: { ...item.to } })) } : {}),
    extra: { ...(root.extra ?? {}), externalDiagramId: link.diagramId, externalRootModelId: root.id },
  }
  useOmniStore.getState().registerModel(model)
  return model.id
}

function findNodeByNormalizedLabel(model: Model, label: string): ModelNode | null {
  const normalized = normalizeExternalMpdLabel(label)
  for (const node of model.nodes.values()) {
    if (normalizeExternalMpdLabel(node.label) === normalized) return node
  }
  return null
}

function cloneNodeMap(nodes: ReadonlyMap<string, ModelNode>): Map<string, ModelNode> {
  const next = new Map<string, ModelNode>()
  for (const [id, node] of nodes) {
    next.set(id, {
      ...node,
      flowEffects: node.flowEffects ? node.flowEffects.map((effect) => ({ ...effect })) : undefined,
      textFormats: node.textFormats ? node.textFormats.map((format) => ({ ...format })) : undefined,
      linkedNodeIds: node.linkedNodeIds ? [...node.linkedNodeIds] : undefined,
      mpdDimensions: node.mpdDimensions ? [...node.mpdDimensions] : undefined,
      externalMpdLinks: node.externalMpdLinks ? { ...node.externalMpdLinks } : undefined,
      externalRmmLink: node.externalRmmLink ? { ...node.externalRmmLink } : undefined,
      extra: node.extra ? { ...node.extra } : undefined,
    })
  }
  return next
}

function cloneEdgeMap(edges: ReadonlyMap<string, Connection>): Map<string, Connection> {
  const next = new Map<string, Connection>()
  for (const [id, edge] of edges) {
    next.set(id, {
      ...edge,
      references: edge.references ? edge.references.map((ref) => ({ ...ref })) : undefined,
      extra: edge.extra ? { ...edge.extra } : undefined,
    })
  }
  return next
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'application/zip' })
}
