import { DEFAULT_EDGE, DEFAULT_NODE, type Connection, type Model, type ModelNode, type Project } from '../model/types'
import { useOmniStore } from '../model/store'
import { applyPatch, type Patch } from '../model/undo'
import type { GraphProposal, GraphProposalStep, TransformProposalEntry } from './forumTypes'
import { findEdgeBetween, proposalSteps } from './forumTypes'
import { acceptTransformProposalBaseline } from './transformDraft'
import { clearSocialEdgeDraft } from './graphDraft'

export type ProposalApplyResult =
  | { status: 'applied' }
  | { status: 'blocked'; reason: string }

export function applyAcceptedProposal(proposal: GraphProposal): ProposalApplyResult {
  if (proposal.status !== 'accepted') return { status: 'blocked', reason: 'Proposal is not accepted' }
  const store = useOmniStore.getState()
  const model = store.model
  const projection = projectProposal(model, useOmniStore.getState().models, proposal)
  if (projection.status === 'blocked') return projection
  if (projection.patches.length > 0) store.applyTransaction(projection.patches)
  if (projection.models.size > 0) {
    useOmniStore.setState((s) => {
      const models = new Map(s.models)
      for (const [id, nextModel] of projection.models) models.set(id, nextModel)
      models.set(s.model.id, s.model)
      return { models, rev: s.rev + 1 }
    })
  }
  for (const edgeId of projection.clearedDraftEdges) clearSocialEdgeDraft(edgeId)
  if (projection.transforms.length > 0) acceptTransformProposalBaseline(projection.transforms, model.id)
  return { status: 'applied' }
}

interface ProposalProjection {
  status: 'applied'
  patches: Patch[]
  models: Map<string, Model>
  clearedDraftEdges: string[]
  transforms: TransformProposalEntry[]
}

function projectProposal(
  model: Model,
  models: ReadonlyMap<string, Model>,
  proposal: GraphProposal,
): ProposalProjection | { status: 'blocked'; reason: string } {
  const projected: Model = {
    ...model,
    nodes: cloneNodeMap(model.nodes),
    edges: cloneEdgeMap(model.edges),
  }
  const newModels = new Map<string, Model>()
  const clearedDraftEdges: string[] = []
  const transforms: TransformProposalEntry[] = []
  const steps = proposalSteps(proposal.payload)
  for (let index = 0; index < steps.length; index++) {
    const result = projectStep(projected, models, newModels, proposal, steps[index], index, steps.length)
    if (result.status === 'blocked') return result
    clearedDraftEdges.push(...result.clearedDraftEdges)
    transforms.push(...result.transforms)
  }
  return {
    status: 'applied',
    patches: diffModels(model, projected),
    models: newModels,
    clearedDraftEdges,
    transforms,
  }
}

function projectStep(
  model: Model,
  models: ReadonlyMap<string, Model>,
  newModels: Map<string, Model>,
  proposal: GraphProposal,
  payload: GraphProposalStep,
  index: number,
  count: number,
): { status: 'applied'; clearedDraftEdges: string[]; transforms: TransformProposalEntry[] } | { status: 'blocked'; reason: string } {
  const clearedDraftEdges: string[] = []
  const transforms: TransformProposalEntry[] = []
  switch (payload.action) {
    case 'add-node': {
      const nodeId = payload.nodeId ?? proposalCreatedNodeId(stepId(proposal.id, index, count))
      if (!model.nodes.has(nodeId)) {
        model.nodes.set(nodeId, {
          ...DEFAULT_NODE,
          id: nodeId,
          label: payload.newNodeLabel.trim() || 'New node',
          x: payload.geometry?.x ?? 50,
          y: payload.geometry?.y ?? 50,
          w: payload.geometry?.w ?? DEFAULT_NODE.w,
          h: payload.geometry?.h ?? DEFAULT_NODE.h,
          shape: payload.shape ?? DEFAULT_NODE.shape,
        })
      }
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'add-node-edge': {
      const source = model.nodes.get(payload.sourceNodeId)
      if (!source) return { status: 'blocked', reason: 'Source node is missing' }
      const nodeId = payload.nodeId ?? proposalCreatedNodeId(stepId(proposal.id, index, count))
      const edgeId = payload.edgeId ?? proposalCreatedEdgeId(stepId(proposal.id, index, count))
      if (!model.nodes.has(nodeId)) {
        const node: ModelNode = {
          ...DEFAULT_NODE,
          id: nodeId,
          label: payload.newNodeLabel.trim() || 'New node',
          x: payload.geometry?.x ?? source.x + Math.max(8, source.w + 3),
          y: payload.geometry?.y ?? source.y,
          w: payload.geometry?.w ?? DEFAULT_NODE.w,
          h: payload.geometry?.h ?? DEFAULT_NODE.h,
          shape: payload.shape ?? DEFAULT_NODE.shape,
        }
        model.nodes.set(node.id, node)
      }
      if (!model.edges.has(edgeId)) {
        const target = model.nodes.get(nodeId)
        if (!target) return { status: 'blocked', reason: 'Created node is unavailable' }
        model.edges.set(edgeId, { ...DEFAULT_EDGE, id: edgeId, from: source.id, to: target.id })
      }
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'add-edge': {
      const source = model.nodes.get(payload.sourceNodeId)
      const target = model.nodes.get(payload.targetNodeId)
      if (!source || !target) return { status: 'blocked', reason: 'Connection endpoint is missing' }
      const edgeId = payload.edgeId ?? proposalCreatedEdgeId(stepId(proposal.id, index, count))
      const existingById = model.edges.get(edgeId)
      if (existingById) {
        if (existingById.from !== source.id || existingById.to !== target.id) {
          return { status: 'blocked', reason: 'Connection id is already used' }
        }
        model.edges.set(edgeId, {
          ...existingById,
          ...(payload.style ?? {}),
          ...(payload.label ? { label: payload.label.trim() } : {}),
          ...(payload.references && payload.references.length > 0 ? { references: payload.references } : {}),
        })
        if (existingById.extra?.socialDraft === true) clearedDraftEdges.push(existingById.id)
        return { status: 'applied', clearedDraftEdges, transforms }
      }
      const existing = findEdgeBetween(model, source.id, target.id)
      if (existing && existing.extra?.socialDraft === true) {
        const { socialDraft, ...extra } = existing.extra
        void socialDraft
        model.edges.set(existing.id, {
          ...existing,
          extra: Object.keys(extra).length > 0 ? extra : undefined,
          ...(payload.style ?? {}),
          ...(payload.label ? { label: payload.label.trim() } : {}),
          ...(payload.references && payload.references.length > 0 ? { references: payload.references } : {}),
        })
        clearedDraftEdges.push(existing.id)
        return { status: 'applied', clearedDraftEdges, transforms }
      }
      if (existing) {
        return { status: 'blocked', reason: 'Connection already exists' }
      }
      model.edges.set(edgeId, {
        ...DEFAULT_EDGE,
        ...(payload.style ?? {}),
        id: edgeId,
        from: source.id,
        to: target.id,
        ...(payload.label ? { label: payload.label.trim() } : {}),
        ...(payload.references && payload.references.length > 0 ? { references: payload.references } : {}),
      })
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'add-rmm': {
      const node = model.nodes.get(payload.nodeId)
      if (!node) return { status: 'blocked', reason: 'Node is missing' }
      if (!node.childModelId) {
        const modelId = proposalCreatedModelId(proposal.id, index, 'rmm')
        model.nodes.set(node.id, { ...node, childModelId: modelId })
        newModels.set(modelId, { id: modelId, name: payload.name.trim(), nodes: new Map(), edges: new Map() })
      }
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'add-mpd': {
      const node = model.nodes.get(payload.nodeId)
      if (!node) return { status: 'blocked', reason: 'Node is missing' }
      const name = payload.name.trim()
      const currentDims = node.mpdDimensions ? [...node.mpdDimensions] : [model.id]
      if (!currentDims.includes(model.id)) currentDims.unshift(model.id)
      if (!currentDims.some((id) => id !== model.id && (newModels.get(id) ?? models.get(id))?.name === name)) {
        const modelId = proposalCreatedModelId(proposal.id, index, 'mpd')
        const dims = [...currentDims, modelId]
        const twin: ModelNode = { ...node, mpdDimensions: dims }
        model.nodes.set(node.id, { ...node, mpdDimensions: dims })
        newModels.set(modelId, { id: modelId, name, nodes: new Map([[twin.id, twin]]), edges: new Map() })
      }
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'remove-edge': {
      if (!model.edges.has(payload.edgeId)) return { status: 'blocked', reason: 'Connection is missing' }
      model.edges.delete(payload.edgeId)
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'remove-node': {
      if (!model.nodes.has(payload.nodeId)) return { status: 'blocked', reason: 'Node is missing' }
      model.nodes.delete(payload.nodeId)
      for (const edge of [...model.edges.values()]) {
        if (edge.from === payload.nodeId || edge.to === payload.nodeId) model.edges.delete(edge.id)
      }
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'rename-node': {
      const node = model.nodes.get(payload.nodeId)
      if (!node) return { status: 'blocked', reason: 'Node is missing' }
      model.nodes.set(node.id, { ...node, label: payload.nextLabel.trim() })
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'rename-edge': {
      const edge = model.edges.get(payload.edgeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      model.edges.set(edge.id, { ...edge, label: payload.nextLabel.trim() })
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'rewire-edge': {
      const edge = model.edges.get(payload.edgeId)
      const target = model.nodes.get(payload.nextTargetNodeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      if (!target) return { status: 'blocked', reason: 'New target node is missing' }
      if (edge.to !== target.id && findEdgeBetween(model, edge.from, target.id)) {
        return { status: 'blocked', reason: 'Rewired connection would duplicate an existing connection' }
      }
      model.edges.set(edge.id, { ...edge, to: target.id })
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'commit-transform': {
      for (const transform of payload.transforms) {
        if (!model.nodes.has(transform.nodeId)) {
          return { status: 'blocked', reason: 'Moved node is missing' }
        }
      }
      for (const transform of payload.transforms) {
        const node = model.nodes.get(transform.nodeId)
        if (node) model.nodes.set(transform.nodeId, { ...node, ...transform.to })
      }
      transforms.push(...payload.transforms)
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'add-reference': {
      const edge = model.edges.get(payload.edgeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      const references = [...(edge.references ?? []), payload.reference]
      model.edges.set(edge.id, { ...edge, references })
      return { status: 'applied', clearedDraftEdges, transforms }
    }
    case 'modify-references': {
      const edge = model.edges.get(payload.edgeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      model.edges.set(edge.id, { ...edge, references: payload.references.length > 0 ? payload.references : undefined })
      return { status: 'applied', clearedDraftEdges, transforms }
    }
  }
}

function cloneNodeMap(nodes: ReadonlyMap<string, ModelNode>): Map<string, ModelNode> {
  const next = new Map<string, ModelNode>()
  for (const [id, node] of nodes) {
    next.set(id, {
      ...node,
      flowEffects: node.flowEffects ? node.flowEffects.map((effect) => ({ ...effect })) : undefined,
      textFormats: node.textFormats ? node.textFormats.map((format) => ({ ...format })) : undefined,
      mpdDimensions: node.mpdDimensions ? [...node.mpdDimensions] : undefined,
      linkedNodeIds: node.linkedNodeIds ? [...node.linkedNodeIds] : undefined,
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

function diffModels(before: Model, after: Model): Patch[] {
  const patches: Patch[] = []
  for (const [id, edge] of before.edges) {
    if (!after.edges.has(id)) patches.push({ kind: 'edge', op: 'remove', edge })
  }
  for (const [id, node] of before.nodes) {
    if (!after.nodes.has(id)) patches.push({ kind: 'node', op: 'remove', node })
  }
  for (const [id, node] of after.nodes) {
    const previous = before.nodes.get(id)
    if (!previous) patches.push({ kind: 'node', op: 'add', node })
    else if (!sameEntity(previous, node)) patches.push({ kind: 'node', op: 'update', id, before: previous, after: node })
  }
  for (const [id, edge] of after.edges) {
    const previous = before.edges.get(id)
    if (!previous) patches.push({ kind: 'edge', op: 'add', edge })
    else if (!sameEntity(previous, edge)) patches.push({ kind: 'edge', op: 'update', id, before: previous, after: edge })
  }
  return patches
}

function sameEntity(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function stepId(proposalId: string, index: number, count: number): string {
  return count === 1 ? proposalId : `${proposalId}_${index + 1}`
}

function proposalCreatedModelId(proposalId: string, index: number, kind: 'rmm' | 'mpd'): string {
  return `proposal_${safeId(proposalId)}_${kind}_${index + 1}`
}

export function previewModelForProposal(model: Model, models: ReadonlyMap<string, Model>, proposal: GraphProposal): Model | null {
  const projection = projectProposal(model, models, proposal)
  if (projection.status === 'blocked') return null
  const preview: Model = { ...model, nodes: cloneNodeMap(model.nodes), edges: cloneEdgeMap(model.edges) }
  for (const patch of projection.patches) applyPatch(patch, preview.nodes, preview.edges)
  return preview
}

export function previewProjectForProposal(project: Project, proposal: GraphProposal): Project | null {
  const model = project.models.get(project.rootModelId)
  if (!model) return null
  const projection = projectProposal(model, project.models, proposal)
  if (projection.status === 'blocked') return null
  const preview: Model = { ...model, nodes: cloneNodeMap(model.nodes), edges: cloneEdgeMap(model.edges) }
  for (const patch of projection.patches) applyPatch(patch, preview.nodes, preview.edges)
  const models = new Map(project.models)
  models.set(model.id, preview)
  for (const [id, nextModel] of projection.models) models.set(id, nextModel)
  return { rootModelId: project.rootModelId, models }
}

export function proposalCreatedNodeId(proposalId: string): string {
  return `proposal_${safeId(proposalId)}_node`
}

export function proposalCreatedEdgeId(proposalId: string): string {
  return `proposal_${safeId(proposalId)}_edge`
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]+/gi, '_')
}
