import type { GraphProposal } from './forumTypes'
import type { Model } from '../model/types'
import {
  activeProposalFootprint,
  emptyProposalFootprint,
  isEdgeLockedByFootprint,
  isNodeLockedByFootprint,
  type ProposalFootprint,
} from './proposalFootprint'

let activeFootprint: ProposalFootprint = emptyProposalFootprint()
const listeners = new Set<() => void>()

export function setActiveProposalLocks(proposals: readonly GraphProposal[], model?: Pick<Model, 'edges'>): void {
  activeFootprint = activeProposalFootprint(proposals, model)
  emit()
}

export function clearActiveProposalLocks(): void {
  activeFootprint = emptyProposalFootprint()
  emit()
}

export function getActiveProposalLocks(): ProposalFootprint {
  return activeFootprint
}

export function isNodeLockedByActiveProposal(nodeId: string): boolean {
  return isNodeLockedByFootprint(activeFootprint, nodeId)
}

export function isEdgeLockedByActiveProposal(edgeId: string): boolean {
  return isEdgeLockedByFootprint(activeFootprint, edgeId)
}

export function subscribeActiveProposalLocks(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(): void {
  for (const listener of listeners) listener()
}
