import { DEFAULT_NODE, type Connection, type ModelNode } from '../model/types'
import { useOmniStore } from '../model/store'
import type { GraphProposal } from './forumTypes'
import { findEdgeBetween } from './forumTypes'
import { acceptTransformProposalBaseline } from './transformDraft'
import { clearSocialEdgeDraft } from './graphDraft'

export type ProposalApplyResult =
  | { status: 'applied' }
  | { status: 'blocked'; reason: string }

export function applyAcceptedProposal(proposal: GraphProposal): ProposalApplyResult {
  if (proposal.status !== 'accepted') return { status: 'blocked', reason: 'Proposal is not accepted' }
  const store = useOmniStore.getState()
  const model = store.model
  const payload = proposal.payload
  switch (payload.action) {
    case 'add-node': {
      const nodeId = proposalCreatedNodeId(proposal.id)
      if (!model.nodes.has(nodeId)) {
        store.addNode({
          id: nodeId,
          label: payload.newNodeLabel.trim() || 'New node',
          x: 50,
          y: 50,
          w: DEFAULT_NODE.w,
          h: DEFAULT_NODE.h,
          shape: DEFAULT_NODE.shape,
        })
      }
      return { status: 'applied' }
    }
    case 'add-node-edge': {
      const source = model.nodes.get(payload.sourceNodeId)
      if (!source) return { status: 'blocked', reason: 'Source node is missing' }
      const nodeId = proposalCreatedNodeId(proposal.id)
      const edgeId = proposalCreatedEdgeId(proposal.id)
      if (!model.nodes.has(nodeId)) {
        const node: Partial<ModelNode> & Pick<ModelNode, 'x' | 'y'> = {
          id: nodeId,
          label: payload.newNodeLabel.trim() || 'New node',
          x: source.x + Math.max(8, source.w + 3),
          y: source.y,
          w: DEFAULT_NODE.w,
          h: DEFAULT_NODE.h,
          shape: DEFAULT_NODE.shape,
        }
        store.addNode(node)
      }
      if (!model.edges.has(edgeId)) {
        const target = useOmniStore.getState().model.nodes.get(nodeId)
        if (!target) return { status: 'blocked', reason: 'Created node is unavailable' }
        store.addEdge(source.id, target.id, { id: edgeId, kind: 'flow' })
      }
      return { status: 'applied' }
    }
    case 'add-edge': {
      const source = model.nodes.get(payload.sourceNodeId)
      const target = model.nodes.get(payload.targetNodeId)
      if (!source || !target) return { status: 'blocked', reason: 'Connection endpoint is missing' }
      const existing = findEdgeBetween(model, source.id, target.id)
      if (existing && existing.extra?.socialDraft === true) {
        const { socialDraft, ...extra } = existing.extra
        void socialDraft
        store.updateEdge(existing.id, { extra: Object.keys(extra).length > 0 ? extra : undefined })
        clearSocialEdgeDraft(existing.id)
        return { status: 'applied' }
      }
      if (existing) {
        return { status: 'blocked', reason: 'Connection already exists' }
      }
      store.addEdge(source.id, target.id, { id: proposalCreatedEdgeId(proposal.id), kind: 'flow' })
      return { status: 'applied' }
    }
    case 'remove-edge': {
      if (!model.edges.has(payload.edgeId)) return { status: 'blocked', reason: 'Connection is missing' }
      store.removeEdges([payload.edgeId])
      return { status: 'applied' }
    }
    case 'remove-node': {
      if (!model.nodes.has(payload.nodeId)) return { status: 'blocked', reason: 'Node is missing' }
      store.removeNodes([payload.nodeId])
      return { status: 'applied' }
    }
    case 'rename-node': {
      const node = model.nodes.get(payload.nodeId)
      if (!node) return { status: 'blocked', reason: 'Node is missing' }
      store.updateNode(node.id, { label: payload.nextLabel.trim() })
      return { status: 'applied' }
    }
    case 'rename-edge': {
      const edge = model.edges.get(payload.edgeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      store.updateEdge(edge.id, { label: payload.nextLabel.trim() })
      return { status: 'applied' }
    }
    case 'rewire-edge': {
      const edge = model.edges.get(payload.edgeId)
      const target = model.nodes.get(payload.nextTargetNodeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      if (!target) return { status: 'blocked', reason: 'New target node is missing' }
      if (edge.to !== target.id && findEdgeBetween(model, edge.from, target.id)) {
        return { status: 'blocked', reason: 'Rewired connection would duplicate an existing connection' }
      }
      const next: Connection = { ...edge, to: target.id }
      store.removeEdges([edge.id])
      store.addEdge(edge.from, target.id, next)
      return { status: 'applied' }
    }
    case 'commit-transform': {
      for (const transform of payload.transforms) {
        if (!model.nodes.has(transform.nodeId)) {
          return { status: 'blocked', reason: 'Moved node is missing' }
        }
      }
      for (const transform of payload.transforms) {
        store.updateNode(transform.nodeId, transform.to)
      }
      acceptTransformProposalBaseline(payload.transforms, model.id)
      return { status: 'applied' }
    }
    case 'add-reference': {
      const edge = model.edges.get(payload.edgeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      const references = [...(edge.references ?? []), payload.reference]
      store.updateEdge(edge.id, { references })
      return { status: 'applied' }
    }
    case 'modify-references': {
      const edge = model.edges.get(payload.edgeId)
      if (!edge) return { status: 'blocked', reason: 'Connection is missing' }
      store.updateEdge(edge.id, { references: payload.references.length > 0 ? payload.references : undefined })
      return { status: 'applied' }
    }
  }
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
