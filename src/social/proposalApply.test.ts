import { beforeEach, describe, expect, it } from 'vitest'
import { useOmniStore } from '../model/store'
import type { GraphProposal, GraphProposalPayload } from './forumTypes'
import { applyAcceptedProposal, proposalCreatedEdgeId, proposalCreatedNodeId } from './proposalApply'
import {
  captureTransformBaseline,
  getTransformDraftEntries,
  markTransformDraftTouched,
  recomputeTransformDraft,
} from './transformDraft'

beforeEach(() => {
  const model = { id: 'root', name: 'test', nodes: new Map(), edges: new Map() }
  useOmniStore.setState({
    model,
    models: new Map([['root', model]]),
    camera: { panX: 0, panY: 0, freeScale: 1 },
    selectedIds: new Set(),
    selectedEdgeIds: new Set(),
    rev: 0,
    selRev: 0,
    defaultConnectionKind: 'flow',
    clipboard: null,
    lastPasteAt: 0,
    pickMode: null,
  })
  useOmniStore.getState().undoStack.clear()
})

describe('applyAcceptedProposal', () => {
  it('adds a deterministic standalone node once', () => {
    const proposal = makeProposal('solo', {
      action: 'add-node',
      newNodeLabel: 'First',
    })
    expect(applyAcceptedProposal(proposal)).toEqual({ status: 'applied' })
    expect(applyAcceptedProposal(proposal)).toEqual({ status: 'applied' })
    const model = useOmniStore.getState().model
    expect(model.nodes.get(proposalCreatedNodeId('solo'))?.label).toBe('First')
    expect(model.nodes.size).toBe(1)
  })

  it('adds a deterministic pending node and connection once', () => {
    const source = useOmniStore.getState().addNode({ id: 'a', x: 10, y: 20, label: 'A' })
    const proposal = makeProposal('p1', {
      action: 'add-node-edge',
      sourceNodeId: source,
      newNodeLabel: 'B',
    })
    expect(applyAcceptedProposal(proposal)).toEqual({ status: 'applied' })
    expect(applyAcceptedProposal(proposal)).toEqual({ status: 'applied' })
    const model = useOmniStore.getState().model
    expect(model.nodes.has(proposalCreatedNodeId('p1'))).toBe(true)
    expect(model.edges.has(proposalCreatedEdgeId('p1'))).toBe(true)
    expect(model.nodes.size).toBe(2)
    expect(model.edges.size).toBe(1)
  })

  it('blocks duplicate add-edge proposals', () => {
    const a = useOmniStore.getState().addNode({ id: 'a', x: 0, y: 0 })
    const b = useOmniStore.getState().addNode({ id: 'b', x: 10, y: 0 })
    useOmniStore.getState().addEdge(a, b)
    const result = applyAcceptedProposal(makeProposal('p2', {
      action: 'add-edge',
      sourceNodeId: a,
      targetNodeId: b,
    }))
    expect(result.status).toBe('blocked')
  })

  it('applies optional label and references on accepted add-edge proposals', () => {
    const a = useOmniStore.getState().addNode({ id: 'a', x: 0, y: 0 })
    const b = useOmniStore.getState().addNode({ id: 'b', x: 10, y: 0 })
    expect(applyAcceptedProposal(makeProposal('edge-meta', {
      action: 'add-edge',
      sourceNodeId: a,
      targetNodeId: b,
      label: 'Supports',
      references: [{ title: 'Paper', citation: 'A. Example', url: 'https://example.test' }],
    }))).toEqual({ status: 'applied' })
    const edge = useOmniStore.getState().model.edges.get(proposalCreatedEdgeId('edge-meta'))
    expect(edge?.label).toBe('Supports')
    expect(edge?.references).toEqual([{ title: 'Paper', citation: 'A. Example', url: 'https://example.test' }])
  })

  it('adds named RMM and MPD dimensions from accepted proposals', () => {
    const a = useOmniStore.getState().addNode({ id: 'a', x: 0, y: 0, label: 'A' })
    expect(applyAcceptedProposal(makeProposal('rmm', {
      action: 'add-rmm',
      nodeId: a,
      name: 'A detail',
    }))).toEqual({ status: 'applied' })
    const rmmId = useOmniStore.getState().model.nodes.get(a)?.childModelId
    expect(rmmId).toBeTruthy()
    expect(useOmniStore.getState().models.get(rmmId ?? '')?.name).toBe('A detail')

    expect(applyAcceptedProposal(makeProposal('mpd', {
      action: 'add-mpd',
      nodeId: a,
      name: 'A alternate',
    }))).toEqual({ status: 'applied' })
    const dims = useOmniStore.getState().model.nodes.get(a)?.mpdDimensions ?? []
    expect(dims.length).toBe(2)
    expect(useOmniStore.getState().models.get(dims[1])?.name).toBe('A alternate')
  })

  it('renames and rewires existing entities', () => {
    const a = useOmniStore.getState().addNode({ id: 'a', x: 0, y: 0, label: 'A' })
    const b = useOmniStore.getState().addNode({ id: 'b', x: 10, y: 0, label: 'B' })
    const c = useOmniStore.getState().addNode({ id: 'c', x: 20, y: 0, label: 'C' })
    const edge = useOmniStore.getState().addEdge(a, b)!
    expect(applyAcceptedProposal(makeProposal('p3', { action: 'rename-node', nodeId: a, nextLabel: 'Alpha' }))).toEqual({ status: 'applied' })
    expect(useOmniStore.getState().model.nodes.get(a)?.label).toBe('Alpha')
    expect(applyAcceptedProposal(makeProposal('p4', { action: 'rewire-edge', edgeId: edge, nextTargetNodeId: c }))).toEqual({ status: 'applied' })
    expect(useOmniStore.getState().model.edges.get(edge)?.to).toBe(c)
  })

  it('applies accepted transform proposals and clears matching local drafts', () => {
    const id = useOmniStore.getState().addNode({ id: 'a', x: 10, y: 20, w: 5, h: 5, label: 'A' })
    const state = useOmniStore.getState()
    captureTransformBaseline({ rootModelId: state.model.id, models: new Map([[state.model.id, state.model]]) })
    useOmniStore.getState().updateNode(id, { x: 18, y: 24, w: 7, h: 6 })
    markTransformDraftTouched('root', [id])
    const snapshot = useOmniStore.getState()
    recomputeTransformDraft({ rootModelId: snapshot.model.id, models: new Map([[snapshot.model.id, snapshot.model]]) })
    expect(getTransformDraftEntries('root')).toHaveLength(1)

    const proposal = makeProposal('move', {
      action: 'commit-transform',
      transforms: [{
        nodeId: id,
        from: { x: 10, y: 20, w: 5, h: 5 },
        to: { x: 18, y: 24, w: 7, h: 6 },
      }],
    })
    expect(applyAcceptedProposal(proposal)).toEqual({ status: 'applied' })
    expect(useOmniStore.getState().model.nodes.get(id)).toMatchObject({ x: 18, y: 24, w: 7, h: 6 })
    expect(getTransformDraftEntries('root')).toHaveLength(0)
  })

  it('ignores geometry drift until a user layout gesture marks it touched', () => {
    const id = useOmniStore.getState().addNode({ id: 'a', x: 10, y: 20, w: 5, h: 5, label: 'A' })
    const state = useOmniStore.getState()
    captureTransformBaseline({ rootModelId: state.model.id, models: new Map([[state.model.id, state.model]]) })
    useOmniStore.getState().updateNode(id, { x: 18, y: 24 })
    const snapshot = useOmniStore.getState()
    recomputeTransformDraft({ rootModelId: snapshot.model.id, models: new Map([[snapshot.model.id, snapshot.model]]) })
    expect(getTransformDraftEntries('root')).toHaveLength(0)

    markTransformDraftTouched('root', [id])
    recomputeTransformDraft({ rootModelId: snapshot.model.id, models: new Map([[snapshot.model.id, snapshot.model]]) })
    expect(getTransformDraftEntries('root')).toHaveLength(1)
  })
})

function makeProposal(id: string, payload: GraphProposalPayload): GraphProposal {
  return {
    id,
    diagramId: 'd1',
    topicId: `t-${id}`,
    action: payload.action,
    payload,
    status: 'accepted',
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(1).toISOString(),
  }
}
