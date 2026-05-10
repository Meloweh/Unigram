import type { Connection, CrossEffectLink, Model, ModelNode, Project } from '../model/types'
import { isExternalMpdId, isExternalRmmId } from '../model/externalMpd'
import type { GraphProposalStep, TransformProposalEntry } from './forumTypes'

let baseline: Project | null = null

const EPSILON = 0.0001

const NODE_SETTINGS_KEYS = [
  'shape',
  'cosmeticType',
  'cellColor',
  'membraneColor',
  'membraneVisible',
  'tip',
  'tipAngle',
  'tipLength',
  'locked',
  'hideDuringFlow',
  'cameraTracked',
  'textFormats',
  'previewOf',
  'extra',
] satisfies readonly (keyof ModelNode)[]

const NODE_MEDIA_KEYS = [
  'mediaType',
  'mediaSrc',
  'mediaFileName',
  'audioCoverSrc',
  'contentSource',
  'contentCollapsed',
  'contentFontSize',
] satisfies readonly (keyof ModelNode)[]

const NODE_FLOW_KEYS = [
  'flowEffects',
  'linkedNodeIds',
] satisfies readonly (keyof ModelNode)[]

const EDGE_SETTINGS_KEYS = [
  'kind',
  'dash',
  'arrowStyle',
  'color',
  'width',
  'labelFontSize',
  'cameraTracked',
  'dependsOnSpawn',
  'hideDuringFlow',
  'extra',
] satisfies readonly (keyof Connection)[]

export function capturePublicGraphBaseline(snapshot: Project): void {
  baseline = cloneProject(snapshot)
}

export function hasPublicGraphBaseline(): boolean {
  return baseline != null
}

export function restorePublicGraphBaseline(): Project | null {
  return baseline ? cloneProject(baseline) : null
}

export function projectWithoutPublicGraphDrafts(snapshot: Project): Project {
  if (!baseline) return snapshot
  const baselineModel = baseline.models.get(baseline.rootModelId)
  const currentModel = snapshot.models.get(snapshot.rootModelId)
  if (!baselineModel || !currentModel) return snapshot
  const models = new Map(snapshot.models)
  models.set(snapshot.rootModelId, {
    ...currentModel,
    nodes: cloneNodeMap(baselineModel.nodes),
    edges: cloneEdgeMap(baselineModel.edges),
    crossLinks: baselineModel.crossLinks ? baselineModel.crossLinks.map(cloneCrossLink) : undefined,
  })
  for (const modelId of snapshot.models.keys()) {
    if (!baseline.models.has(modelId) && modelId !== snapshot.rootModelId) models.delete(modelId)
  }
  return { rootModelId: snapshot.rootModelId, models }
}

export function getPublicGraphDraftSteps(snapshot: Project): GraphProposalStep[] {
  if (!baseline) return []
  const before = baseline.models.get(baseline.rootModelId)
  const after = snapshot.models.get(snapshot.rootModelId)
  if (!before || !after) return []
  return diffModelToSteps(before, after, baseline.models, snapshot.models)
}

export function getPublicGraphDraftCount(snapshot: Project): number {
  return getPublicGraphDraftSteps(snapshot).length
}

function diffModelToSteps(
  before: Model,
  after: Model,
  beforeModels: ReadonlyMap<string, Model>,
  afterModels: ReadonlyMap<string, Model>,
): GraphProposalStep[] {
  const steps: GraphProposalStep[] = []
  const addedNodeIds = new Set<string>()
  const removedNodeIds = new Set<string>()

  let capturedCrossLinkChange = false
  for (const [id, node] of after.nodes) {
    if (before.nodes.has(id)) continue
    addedNodeIds.add(id)
    steps.push({
      action: 'add-node',
      nodeId: id,
      newNodeLabel: draftNodeDisplayLabel(node),
      geometry: geometryOf(node),
      shape: node.shape,
      node: cloneNode(node),
    })
  }

  for (const id of before.nodes.keys()) {
    if (!after.nodes.has(id)) removedNodeIds.add(id)
  }

  const replacedEdgeIds = new Set<string>()
  for (const [id, edge] of after.edges) {
    const previous = before.edges.get(id)
    if (!previous) {
      if (!after.nodes.has(edge.from) || !after.nodes.has(edge.to)) continue
      steps.push(edgeToAddStep(edge))
      continue
    }
    if (previous.from === edge.from && previous.to !== edge.to && after.nodes.has(edge.to)) {
      steps.push({ action: 'rewire-edge', edgeId: edge.id, nextTargetNodeId: edge.to })
    } else if (previous.from !== edge.from || previous.to !== edge.to) {
      replacedEdgeIds.add(edge.id)
      if (before.nodes.has(previous.from) && before.nodes.has(previous.to)) steps.push({ action: 'remove-edge', edgeId: previous.id })
      if (after.nodes.has(edge.from) && after.nodes.has(edge.to)) steps.push(edgeToAddStep(edge))
      continue
    }
  }

  for (const [id, node] of after.nodes) {
    const previous = before.nodes.get(id)
    if (!previous || removedNodeIds.has(id)) continue
    const nextLabel = node.label.trim()
    if (previous.label.trim() !== nextLabel) steps.push({ action: 'rename-node', nodeId: id, nextLabel: nextLabel || id })
    if (!previous.childModelId && node.childModelId && !beforeModels.has(node.childModelId)) {
      if (isExternalRmmId(node.childModelId) && node.externalRmmLink) {
        steps.push({
          action: 'add-rmm',
          nodeId: id,
          name: node.externalRmmLink.diagramTitle,
          externalLink: node.externalRmmLink,
        })
      } else {
        steps.push({ action: 'add-rmm', nodeId: id, name: afterModels.get(node.childModelId)?.name.trim() || 'RMM dimension' })
      }
    }
    const previousDims = new Set(previous.mpdDimensions ?? [])
    for (const dimensionId of node.mpdDimensions ?? []) {
      if (dimensionId === after.id || dimensionId === node.childModelId) continue
      if (previousDims.has(dimensionId) || beforeModels.has(dimensionId)) continue
      if (isExternalMpdId(dimensionId)) {
        const externalLink = node.externalMpdLinks?.[dimensionId]
        if (externalLink) {
          steps.push({
            action: 'add-mpd',
            nodeId: id,
            name: externalLink.diagramTitle,
            externalLink,
          })
        }
        continue
      }
      steps.push({ action: 'add-mpd', nodeId: id, name: afterModels.get(dimensionId)?.name.trim() || 'MPD dimension' })
    }
    const settings = changedPatch(previous, node, NODE_SETTINGS_KEYS)
    if (settings) steps.push({ action: 'update-node-settings', nodeId: id, ...settings })
    const media = changedPatch(previous, node, NODE_MEDIA_KEYS)
    if (media) steps.push({ action: 'update-node-media', nodeId: id, ...media })
    const flow = changedPatch(previous, node, NODE_FLOW_KEYS)
    const crossLinks = capturedCrossLinkChange || sameEntity(previousFlowCrossLinks(before, id), previousFlowCrossLinks(after, id))
      ? null
      : {
        crossLinksBefore: before.crossLinks ? before.crossLinks.map(cloneCrossLink) : [],
        crossLinksAfter: after.crossLinks ? after.crossLinks.map(cloneCrossLink) : [],
      }
    if (flow || crossLinks) {
      if (crossLinks) capturedCrossLinkChange = true
      steps.push({
        action: 'update-flow-effects',
        nodeId: id,
        ...(flow ?? { before: stableFlowPatch(previous), after: stableFlowPatch(node) }),
        ...(crossLinks ?? {}),
      })
    }
  }

  for (const [id, edge] of after.edges) {
    const previous = before.edges.get(id)
    if (!previous || replacedEdgeIds.has(id)) continue
    const previousLabel = previous.label?.trim() ?? ''
    const nextLabel = edge.label?.trim() ?? ''
    if (previousLabel !== nextLabel) {
      steps.push({ action: 'rename-edge', edgeId: id, nextLabel })
    }
    if (!sameReferences(previous.references, edge.references)) {
      steps.push({ action: 'modify-references', edgeId: id, references: edge.references ? edge.references.map((ref) => ({ ...ref })) : [] })
    }
    const settings = changedPatch(previous, edge, EDGE_SETTINGS_KEYS)
    if (settings) steps.push({ action: 'update-edge-settings', edgeId: id, ...settings })
  }

  const transforms: TransformProposalEntry[] = []
  for (const [id, node] of after.nodes) {
    const previous = before.nodes.get(id)
    if (!previous || addedNodeIds.has(id) || removedNodeIds.has(id)) continue
    const from = geometryOf(previous)
    const to = geometryOf(node)
    if (!sameGeometry(from, to)) transforms.push({ nodeId: id, from, to })
  }
  if (transforms.length > 0) steps.push({ action: 'commit-transform', transforms })

  for (const [id, edge] of before.edges) {
    if (after.edges.has(id)) continue
    if (removedNodeIds.has(edge.from) || removedNodeIds.has(edge.to)) continue
    steps.push({ action: 'remove-edge', edgeId: id })
  }
  for (const id of removedNodeIds) steps.push({ action: 'remove-node', nodeId: id })

  return steps
}

function edgeToAddStep(edge: Connection): GraphProposalStep {
  return {
    action: 'add-edge',
    edgeId: edge.id,
    sourceNodeId: edge.from,
    targetNodeId: edge.to,
    edge: cloneEdge(edge),
    ...(edge.label?.trim() ? { label: edge.label.trim() } : {}),
    ...(edge.references && edge.references.length > 0 ? { references: edge.references.map((ref) => ({ ...ref })) } : {}),
    style: {
      kind: edge.kind,
      dash: edge.dash,
      arrowStyle: edge.arrowStyle,
      color: edge.color,
      width: edge.width,
      labelFontSize: edge.labelFontSize,
      cameraTracked: edge.cameraTracked,
    },
  }
}

function draftNodeDisplayLabel(node: ModelNode): string {
  const label = node.label.trim()
  if (label) return label
  const kind = node.cosmeticType || node.shape
  if (kind) return kind.replace(/-/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
  return node.id
}

function changedPatch<T extends object>(
  before: T,
  after: T,
  keys: readonly (keyof T)[],
): { before: Partial<{ [K in keyof T]: T[K] | null }>; after: Partial<{ [K in keyof T]: T[K] | null }> } | null {
  const previousPatch: Record<string, unknown> = {}
  const nextPatch: Record<string, unknown> = {}
  const beforeRecord = before as Record<string, unknown>
  const afterRecord = after as Record<string, unknown>
  for (const key of keys) {
    const field = String(key)
    if (sameEntity(beforeRecord[field], afterRecord[field])) continue
    previousPatch[field] = patchValue(beforeRecord[field])
    nextPatch[field] = patchValue(afterRecord[field])
  }
  if (Object.keys(nextPatch).length === 0) return null
  return {
    before: previousPatch as Partial<{ [K in keyof T]: T[K] | null }>,
    after: nextPatch as Partial<{ [K in keyof T]: T[K] | null }>,
  }
}

function previousFlowCrossLinks(model: Model, nodeId: string): CrossEffectLink[] {
  return (model.crossLinks ?? [])
    .filter((link) => link.from.nodeId === nodeId || link.to.nodeId === nodeId)
    .map(cloneCrossLink)
}

function stableFlowPatch(node: ModelNode): Partial<{ [K in keyof ModelNode]: ModelNode[K] | null }> {
  return {
    flowEffects: node.flowEffects ? cloneJson(node.flowEffects) : null,
    linkedNodeIds: node.linkedNodeIds ? [...node.linkedNodeIds] : null,
  }
}

function patchValue(value: unknown): unknown {
  if (value === undefined) return null
  return cloneJson(value)
}

function cloneJson<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneProject(project: Project): Project {
  const models = new Map<string, Model>()
  for (const [id, model] of project.models) {
    models.set(id, {
      ...model,
      nodes: cloneNodeMap(model.nodes),
      edges: cloneEdgeMap(model.edges),
      crossLinks: model.crossLinks ? model.crossLinks.map(cloneCrossLink) : undefined,
      grid: model.grid ? { ...model.grid } : undefined,
      cosmetics: model.cosmetics ? { ...model.cosmetics } : undefined,
      extra: model.extra ? { ...model.extra } : undefined,
    })
  }
  return { rootModelId: project.rootModelId, models }
}

function cloneNodeMap(nodes: ReadonlyMap<string, ModelNode>): Map<string, ModelNode> {
  const next = new Map<string, ModelNode>()
  for (const [id, node] of nodes) {
    next.set(id, cloneNode(node))
  }
  return next
}

function cloneEdgeMap(edges: ReadonlyMap<string, Connection>): Map<string, Connection> {
  const next = new Map<string, Connection>()
  for (const [id, edge] of edges) {
    next.set(id, cloneEdge(edge))
  }
  return next
}

function cloneNode(node: ModelNode): ModelNode {
  return {
    ...node,
    textFormats: node.textFormats ? node.textFormats.map((format) => ({ ...format })) : undefined,
    flowEffects: node.flowEffects ? node.flowEffects.map((effect) => cloneJson(effect)) : undefined,
    linkedNodeIds: node.linkedNodeIds ? [...node.linkedNodeIds] : undefined,
    mpdDimensions: node.mpdDimensions ? [...node.mpdDimensions] : undefined,
    externalMpdLinks: node.externalMpdLinks ? { ...node.externalMpdLinks } : undefined,
    externalRmmLink: node.externalRmmLink ? { ...node.externalRmmLink } : undefined,
    previewOf: node.previewOf ? { ...node.previewOf } : undefined,
    tip: node.tip ? { ...node.tip } : undefined,
    extra: node.extra ? cloneJson(node.extra) : undefined,
  }
}

function cloneEdge(edge: Connection): Connection {
  return {
    ...edge,
    references: edge.references ? edge.references.map((ref) => ({ ...ref })) : undefined,
    extra: edge.extra ? cloneJson(edge.extra) : undefined,
  }
}

function cloneCrossLink<T extends { from: object; to: object }>(link: T): T {
  return { ...link, from: { ...link.from }, to: { ...link.to } }
}

function geometryOf(node: Pick<ModelNode, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number; w: number; h: number } {
  return { x: node.x, y: node.y, w: node.w, h: node.h }
}

function sameGeometry(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return (
    Math.abs(a.x - b.x) <= EPSILON &&
    Math.abs(a.y - b.y) <= EPSILON &&
    Math.abs(a.w - b.w) <= EPSILON &&
    Math.abs(a.h - b.h) <= EPSILON
  )
}

function sameReferences(a: Connection['references'], b: Connection['references']): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

function sameEntity(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}
