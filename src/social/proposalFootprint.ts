import type { Connection, Model } from '../model/types'
import type { GraphProposal, GraphProposalPayload, GraphProposalStep } from './forumTypes'
import { proposalSteps } from './forumTypes'

export interface ProposalFootprint {
  nodeIds: Set<string>
  edgeIds: Set<string>
  endpointNodeIds: Set<string>
  endpointPairs: Set<string>
  proposedNodeIds: Set<string>
  proposedEdgeIds: Set<string>
  changeKeys: Set<string>
}

export function emptyProposalFootprint(): ProposalFootprint {
  return {
    nodeIds: new Set(),
    edgeIds: new Set(),
    endpointNodeIds: new Set(),
    endpointPairs: new Set(),
    proposedNodeIds: new Set(),
    proposedEdgeIds: new Set(),
    changeKeys: new Set(),
  }
}

export function proposalFootprint(
  payload: GraphProposalPayload,
  model?: Pick<Model, 'edges'>,
  proposalId = 'proposal',
): ProposalFootprint {
  const footprint = emptyProposalFootprint()
  const steps = proposalSteps(payload)
  for (let index = 0; index < steps.length; index++) {
    addStepFootprint(footprint, steps[index], model, stepId(proposalId, index, steps.length))
  }
  return footprint
}

export function activeProposalFootprint(
  proposals: readonly GraphProposal[],
  model?: Pick<Model, 'edges'>,
): ProposalFootprint {
  const footprint = emptyProposalFootprint()
  for (const proposal of proposals) {
    if (proposal.status !== 'pending' && proposal.status !== 'accepted') continue
    mergeFootprint(footprint, proposalFootprint(proposal.payload, model, proposal.id))
  }
  return footprint
}

export function footprintsOverlap(a: ProposalFootprint, b: ProposalFootprint): boolean {
  return (
    intersects(a.nodeIds, b.nodeIds) ||
    intersects(a.nodeIds, b.endpointNodeIds) ||
    intersects(a.endpointNodeIds, b.nodeIds) ||
    intersects(a.edgeIds, b.edgeIds) ||
    intersects(a.endpointPairs, b.endpointPairs) ||
    intersects(a.proposedNodeIds, b.proposedNodeIds) ||
    intersects(a.proposedEdgeIds, b.proposedEdgeIds) ||
    intersects(a.changeKeys, b.changeKeys)
  )
}

export function isNodeLockedByFootprint(footprint: ProposalFootprint, nodeId: string): boolean {
  return footprint.nodeIds.has(nodeId) || footprint.proposedNodeIds.has(nodeId)
}

export function isEdgeLockedByFootprint(footprint: ProposalFootprint, edgeId: string): boolean {
  return footprint.edgeIds.has(edgeId) || footprint.proposedEdgeIds.has(edgeId)
}

function addStepFootprint(
  footprint: ProposalFootprint,
  step: GraphProposalStep,
  model: Pick<Model, 'edges'> | undefined,
  suffix: string,
): void {
  switch (step.action) {
    case 'add-node': {
      const nodeId = step.nodeId ?? proposalCreatedNodeId(suffix)
      footprint.proposedNodeIds.add(nodeId)
      footprint.nodeIds.add(nodeId)
      footprint.changeKeys.add(`add-node:${semanticNodeLabel(step.newNodeLabel, step.node?.label)}:${semanticGeometry(step.geometry ?? step.node)}`)
      return
    }
    case 'add-node-edge': {
      const nodeId = step.nodeId ?? proposalCreatedNodeId(suffix)
      const edgeId = step.edgeId ?? proposalCreatedEdgeId(suffix)
      footprint.proposedNodeIds.add(nodeId)
      footprint.proposedEdgeIds.add(edgeId)
      footprint.nodeIds.add(nodeId)
      footprint.edgeIds.add(edgeId)
      addEndpointPair(footprint, step.sourceNodeId, nodeId)
      footprint.changeKeys.add(`add-node-edge:${step.sourceNodeId}:${semanticNodeLabel(step.newNodeLabel, step.node?.label)}:${semanticGeometry(step.geometry ?? step.node)}`)
      return
    }
    case 'add-edge': {
      const edgeId = step.edgeId ?? proposalCreatedEdgeId(suffix)
      footprint.proposedEdgeIds.add(edgeId)
      footprint.edgeIds.add(edgeId)
      addEndpointPair(footprint, step.sourceNodeId, step.targetNodeId)
      footprint.changeKeys.add(`add-edge:${step.sourceNodeId}:${step.targetNodeId}`)
      return
    }
    case 'remove-node':
    case 'rename-node':
    case 'add-rmm':
    case 'add-mpd':
    case 'update-node-settings':
    case 'update-node-media':
    case 'update-flow-effects':
      footprint.nodeIds.add(step.nodeId)
      return
    case 'commit-transform':
      for (const transform of step.transforms) footprint.nodeIds.add(transform.nodeId)
      return
    case 'remove-edge':
    case 'rename-edge':
    case 'add-reference':
    case 'modify-references':
    case 'update-edge-settings':
      footprint.edgeIds.add(step.edgeId)
      addKnownEdgeEndpoints(footprint, model?.edges.get(step.edgeId))
      return
    case 'rewire-edge': {
      footprint.edgeIds.add(step.edgeId)
      const edge = model?.edges.get(step.edgeId)
      addKnownEdgeEndpoints(footprint, edge)
      if (edge) addEndpointPair(footprint, edge.from, step.nextTargetNodeId)
      return
    }
  }
}

function mergeFootprint(target: ProposalFootprint, source: ProposalFootprint): void {
  for (const nodeId of source.nodeIds) target.nodeIds.add(nodeId)
  for (const edgeId of source.edgeIds) target.edgeIds.add(edgeId)
  for (const nodeId of source.endpointNodeIds) target.endpointNodeIds.add(nodeId)
  for (const pair of source.endpointPairs) target.endpointPairs.add(pair)
  for (const nodeId of source.proposedNodeIds) target.proposedNodeIds.add(nodeId)
  for (const edgeId of source.proposedEdgeIds) target.proposedEdgeIds.add(edgeId)
  for (const key of source.changeKeys) target.changeKeys.add(key)
}

function addKnownEdgeEndpoints(footprint: ProposalFootprint, edge: Connection | undefined): void {
  if (!edge) return
  addEndpointPair(footprint, edge.from, edge.to)
}

function addEndpointPair(footprint: ProposalFootprint, from: string, to: string): void {
  footprint.endpointNodeIds.add(from)
  footprint.endpointNodeIds.add(to)
  footprint.endpointPairs.add(`${from}\u0000${to}`)
}

function semanticNodeLabel(primary: string, fallback?: string): string {
  return (fallback || primary).trim().toLowerCase().replace(/\s+/g, ' ')
}

function semanticGeometry(value: { x?: number; y?: number; w?: number; h?: number } | undefined): string {
  if (!value) return ''
  return [value.x, value.y, value.w, value.h].map((part) => Number.isFinite(part) ? Number(part).toFixed(3) : '').join(':')
}

function stepId(proposalId: string, index: number, count: number): string {
  return count === 1 ? proposalId : `${proposalId}_${index + 1}`
}

function proposalCreatedNodeId(proposalId: string): string {
  return `proposal_${safeId(proposalId)}_node`
}

function proposalCreatedEdgeId(proposalId: string): string {
  return `proposal_${safeId(proposalId)}_edge`
}

function safeId(id: string): string {
  return id.replace(/[^a-z0-9_-]+/gi, '_')
}

function intersects<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size === 0 || b.size === 0) return false
  const small = a.size <= b.size ? a : b
  const large = a.size <= b.size ? b : a
  for (const item of small) if (large.has(item)) return true
  return false
}
