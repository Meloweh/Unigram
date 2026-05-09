import { importBundle } from '../model/projectBundle'
import { useOmniStore } from '../model/store'
import type { ExternalMpdLink, Model, ModelNode } from '../model/types'
import { completeExternalMpdLink, normalizeExternalMpdLabel } from '../model/externalMpd'
import { SCENE_H, SCENE_W } from '../scene/sceneConstants'
import { getCloudDiagram } from '../social/cloudClient'

export type MpdRuntimeOption =
  | { id: string; label: string; kind: 'local' }
  | { id: string; label: string; kind: 'external'; link: ExternalMpdLink }

export interface MpdCurtainHooks {
  begin(): void
  play(direction: 'left' | 'right', durationMs: number): void
}

export function resolveMpdOptions(
  node: ModelNode,
  models: ReadonlyMap<string, Model>,
): MpdRuntimeOption[] {
  const options: MpdRuntimeOption[] = []
  for (const id of node.mpdDimensions ?? []) {
    const local = models.get(id)
    if (local) {
      options.push({ id, label: local.name, kind: 'local' })
      continue
    }
    const link = node.externalMpdLinks?.[id]
    if (link) options.push({ id, label: link.diagramTitle, kind: 'external', link: completeExternalMpdLink(link) })
  }
  return options
}

export async function switchMpdDimension(
  sourceId: string,
  option: MpdRuntimeOption,
  direction: 'left' | 'right',
  hooks?: MpdCurtainHooks,
  durationMs = 500,
): Promise<void> {
  const state = useOmniStore.getState()
  if (option.id === state.model.id) return
  const sourceNode = state.model.nodes.get(sourceId)
  if (!sourceNode) return
  const target = option.kind === 'external'
    ? await materializeExternalModel(option.link, sourceNode, sourceId)
    : materializeLocalModel(option.id, sourceNode, sourceId)
  if (!target) return

  const dx = ((sourceNode.x - target.node.x) / 100) * SCENE_W
  const dy = ((sourceNode.y - target.node.y) / 100) * SCENE_H
  hooks?.begin()
  const store = useOmniStore.getState()
  if (option.kind === 'external') store.registerModel(target.model)
  store.setActiveModel(target.model.id)
  store.select(target.node.id)
  const cam = useOmniStore.getState().camera
  useOmniStore.getState().setCamera({ panX: cam.panX + dx, panY: cam.panY + dy })
  hooks?.play(direction, durationMs)
}

function materializeLocalModel(
  modelId: string,
  sourceNode: ModelNode,
  sourceId: string,
): { model: Model; node: ModelNode } | null {
  const model = useOmniStore.getState().models.get(modelId)
  if (!model) return null
  const originNodeId = typeof sourceNode.extra?.externalMpdOriginNodeId === 'string'
    ? sourceNode.extra.externalMpdOriginNodeId
    : sourceId
  const node = model.nodes.get(originNodeId) ?? findNodeByNormalizedLabel(model, sourceNode.label)
  return node ? { model, node } : null
}

async function materializeExternalModel(
  rawLink: ExternalMpdLink,
  sourceNode: ModelNode,
  sourceId: string,
): Promise<{ model: Model; node: ModelNode } | null> {
  const link = completeExternalMpdLink(rawLink)
  const diagram = await getCloudDiagram(link.diagramId)
  if (!diagram.bundleBase64) return null
  const project = await importBundle(base64ToBlob(diagram.bundleBase64))
  const root = project.models.get(project.rootModelId)
  if (!root) return null
  const matched = link.targetNodeId
    ? root.nodes.get(link.targetNodeId) ?? findNodeByNormalizedLabel(root, link.nodeLabel)
    : findNodeByNormalizedLabel(root, link.nodeLabel)
  if (!matched) return null
  const nodes = new Map<string, ModelNode>()
  for (const [id, node] of root.nodes) {
    const next = id === matched.id
      ? patchExternalTwin(node, sourceNode, sourceId)
      : cloneNode(node)
    nodes.set(next.id, next)
  }
  const model: Model = {
    ...root,
    id: link.id,
    name: diagram.title || link.diagramTitle,
    nodes,
    edges: new Map(root.edges),
    ...(root.crossLinks ? { crossLinks: root.crossLinks.map((item) => ({ ...item, from: { ...item.from }, to: { ...item.to } })) } : {}),
    extra: { ...(root.extra ?? {}), externalDiagramId: link.diagramId, externalRootModelId: root.id },
  }
  return { model, node: nodes.get(matched.id) ?? matched }
}

function patchExternalTwin(node: ModelNode, sourceNode: ModelNode, sourceId: string): ModelNode {
  return {
    ...cloneNode(node),
    mpdDimensions: sourceNode.mpdDimensions ? [...sourceNode.mpdDimensions] : undefined,
    externalMpdLinks: sourceNode.externalMpdLinks ? { ...sourceNode.externalMpdLinks } : undefined,
    extra: {
      ...(node.extra ?? {}),
      externalMpdOriginNodeId: typeof sourceNode.extra?.externalMpdOriginNodeId === 'string'
        ? sourceNode.extra.externalMpdOriginNodeId
        : sourceId,
    },
  }
}

function findNodeByNormalizedLabel(model: Model, label: string): ModelNode | null {
  const normalized = normalizeExternalMpdLabel(label)
  for (const node of model.nodes.values()) {
    if (normalizeExternalMpdLabel(node.label) === normalized) return node
  }
  return null
}

function cloneNode(node: ModelNode): ModelNode {
  return {
    ...node,
    flowEffects: node.flowEffects ? node.flowEffects.map((effect) => ({ ...effect })) : undefined,
    textFormats: node.textFormats ? node.textFormats.map((format) => ({ ...format })) : undefined,
    linkedNodeIds: node.linkedNodeIds ? [...node.linkedNodeIds] : undefined,
    mpdDimensions: node.mpdDimensions ? [...node.mpdDimensions] : undefined,
    externalMpdLinks: node.externalMpdLinks ? { ...node.externalMpdLinks } : undefined,
    extra: node.extra ? { ...node.extra } : undefined,
  }
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'application/zip' })
}
