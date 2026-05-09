import type { Connection, Model, ModelNode, Project } from '../model/types'
import type { GraphProposalStep, TransformProposalEntry } from './forumTypes'

let baseline: Project | null = null

const EPSILON = 0.0001

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

  for (const [id, node] of after.nodes) {
    if (before.nodes.has(id)) continue
    addedNodeIds.add(id)
    steps.push({
      action: 'add-node',
      nodeId: id,
      newNodeLabel: node.label.trim() || id,
      geometry: geometryOf(node),
      shape: node.shape,
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
      steps.push({ action: 'add-rmm', nodeId: id, name: afterModels.get(node.childModelId)?.name.trim() || 'RMM dimension' })
    }
    const previousDims = new Set(previous.mpdDimensions ?? [])
    for (const dimensionId of node.mpdDimensions ?? []) {
      if (dimensionId === after.id || dimensionId === node.childModelId) continue
      if (previousDims.has(dimensionId) || beforeModels.has(dimensionId)) continue
      steps.push({ action: 'add-mpd', nodeId: id, name: afterModels.get(dimensionId)?.name.trim() || 'MPD dimension' })
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
    next.set(id, {
      ...node,
      textFormats: node.textFormats ? node.textFormats.map((format) => ({ ...format })) : undefined,
      flowEffects: node.flowEffects ? node.flowEffects.map((effect) => ({ ...effect })) : undefined,
      linkedNodeIds: node.linkedNodeIds ? [...node.linkedNodeIds] : undefined,
      mpdDimensions: node.mpdDimensions ? [...node.mpdDimensions] : undefined,
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
