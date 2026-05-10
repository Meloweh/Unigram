import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE, type Model } from '../model/types'
import type { GraphProposal } from './forumTypes'
import {
  activeProposalFootprint,
  footprintsOverlap,
  isEdgeLockedByFootprint,
  isNodeLockedByFootprint,
  proposalFootprint,
} from './proposalFootprint'

describe('proposalFootprint', () => {
  it('detects overlapping node changes across different proposal actions', () => {
    const move = proposalFootprint({
      action: 'commit-transform',
      transforms: [{ nodeId: 'a', from: { x: 1, y: 1, w: 2, h: 2 }, to: { x: 3, y: 3, w: 2, h: 2 } }],
    })
    const settings = proposalFootprint({
      action: 'update-node-settings',
      nodeId: 'a',
      after: { cameraTracked: true },
    })

    expect(footprintsOverlap(move, settings)).toBe(true)
    expect(isNodeLockedByFootprint(move, 'a')).toBe(true)
  })

  it('detects duplicate endpoint-pair additions even with different edge ids', () => {
    const first = proposalFootprint({ action: 'add-edge', edgeId: 'edge-1', sourceNodeId: 'a', targetNodeId: 'b' })
    const second = proposalFootprint({ action: 'add-edge', edgeId: 'edge-2', sourceNodeId: 'a', targetNodeId: 'b' })

    expect(footprintsOverlap(first, second)).toBe(true)
    expect(isEdgeLockedByFootprint(first, 'edge-1')).toBe(true)
  })

  it('uses existing edge endpoints when locking edge mutations', () => {
    const model = modelWithEdge()
    const rename = proposalFootprint({ action: 'rename-edge', edgeId: 'edge-ab', nextLabel: 'next' }, model)
    const duplicateEndpoint = proposalFootprint({ action: 'add-edge', sourceNodeId: 'a', targetNodeId: 'b' }, model)

    expect(footprintsOverlap(rename, duplicateEndpoint)).toBe(true)
  })

  it('only includes pending and accepted proposals in the active lock footprint', () => {
    const active = activeProposalFootprint([
      proposal('pending-node', 'pending', { action: 'rename-node', nodeId: 'a', nextLabel: 'A' }),
      proposal('accepted-edge', 'accepted', { action: 'rename-edge', edgeId: 'edge-ab', nextLabel: 'AB' }),
      proposal('applied-node', 'applied', { action: 'rename-node', nodeId: 'b', nextLabel: 'B' }),
    ])

    expect(isNodeLockedByFootprint(active, 'a')).toBe(true)
    expect(isNodeLockedByFootprint(active, 'b')).toBe(false)
    expect(isEdgeLockedByFootprint(active, 'edge-ab')).toBe(true)
  })
})

function modelWithEdge(): Pick<Model, 'edges'> {
  return {
    edges: new Map([
      ['edge-ab', { ...DEFAULT_EDGE, id: 'edge-ab', from: 'a', to: 'b' }],
    ]),
  }
}

function proposal(id: string, status: GraphProposal['status'], payload: GraphProposal['payload']): GraphProposal {
  return {
    id,
    diagramId: 'diagram',
    topicId: `topic-${id}`,
    action: payload.action,
    payload,
    status,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(1).toISOString(),
  }
}
