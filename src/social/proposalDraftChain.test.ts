import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE, DEFAULT_NODE, type Model } from '../model/types'
import { buildGraphDraftSteps } from './proposalDraftChain'

describe('buildGraphDraftSteps', () => {
  it('serializes social edge drafts before layout transforms', () => {
    const model: Model = {
      id: 'root',
      name: 'Graph',
      nodes: new Map([
        ['a', { ...DEFAULT_NODE, id: 'a', x: 0, y: 0, label: 'A' }],
        ['b', { ...DEFAULT_NODE, id: 'b', x: 10, y: 0, label: 'B' }],
      ]),
      edges: new Map([
        ['edge-ab', {
          ...DEFAULT_EDGE,
          id: 'edge-ab',
          from: 'a',
          to: 'b',
          label: 'Supports',
          references: [{ title: 'Source', citation: 'A. Example', url: 'https://example.test' }],
          width: 0.25,
          cameraTracked: true,
        }],
      ]),
    }
    const transforms = [{
      nodeId: 'a',
      from: { x: 0, y: 0, w: 5, h: 5 },
      to: { x: 3, y: 4, w: 7, h: 6 },
    }]

    const steps = buildGraphDraftSteps(model, transforms, [{ edgeId: 'edge-ab', from: 'a', to: 'b' }])

    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({
      action: 'add-edge',
      edgeId: 'edge-ab',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      label: 'Supports',
      style: { width: 0.25, cameraTracked: true },
    })
    expect(steps[1]).toEqual({ action: 'commit-transform', transforms })
  })

  it('skips stale edge draft ids while keeping transform drafts', () => {
    const model: Model = {
      id: 'root',
      name: 'Graph',
      nodes: new Map(),
      edges: new Map(),
    }
    const transforms = [{
      nodeId: 'a',
      from: { x: 0, y: 0, w: 5, h: 5 },
      to: { x: 1, y: 1, w: 5, h: 5 },
    }]

    expect(buildGraphDraftSteps(model, transforms, [{ edgeId: 'missing', from: 'a', to: 'b' }])).toEqual([
      { action: 'commit-transform', transforms },
    ])
  })
})
