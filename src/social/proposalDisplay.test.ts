import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE, DEFAULT_NODE, type Model } from '../model/types'
import { changeGroupsForSteps } from './proposalDisplay'
import type { GraphProposalStep } from './forumTypes'

const model: Model = {
  id: 'root',
  name: 'Root',
  nodes: new Map([
    ['a', { ...DEFAULT_NODE, id: 'a', label: 'A', x: 10, y: 10 }],
    ['b', { ...DEFAULT_NODE, id: 'b', label: 'B', x: 30, y: 10 }],
  ]),
  edges: new Map([
    ['edge-ab', { ...DEFAULT_EDGE, id: 'edge-ab', from: 'a', to: 'b' }],
  ]),
}

describe('proposal display groups', () => {
  it('expands rich added cosmetic nodes into granular details', () => {
    const steps: GraphProposalStep[] = [{
      action: 'add-node',
      nodeId: 'cloud',
      newNodeLabel: 'Thinking cloud',
      node: {
        ...DEFAULT_NODE,
        id: 'cloud',
        label: '',
        x: 40,
        y: 40,
        w: 16,
        h: 10,
        shape: 'thinking-cloud',
        cosmeticType: 'thinking-cloud',
        cellColor: '#eaf3ff',
        membraneColor: '#f59e0b',
        cameraTracked: true,
        hideDuringFlow: true,
        tipAngle: 1.2,
        tipLength: 34,
        childModelId: 'rmm-1',
        mpdDimensions: ['root', 'mpd-1'],
        flowEffects: [{
          id: 'fx',
          label: 'Levitate',
          graph: {
            nodes: [{ id: 'n1', kind: 'cloud-levitate', x: 0, y: 0, params: {} }],
            edges: [],
          },
        }],
      },
    }]
    const models = new Map([
      ['root', model],
      ['rmm-1', { id: 'rmm-1', name: 'Cloud room', nodes: new Map(), edges: new Map() }],
      ['mpd-1', { id: 'mpd-1', name: 'Cloud variant', nodes: new Map(), edges: new Map() }],
    ])

    const [group] = changeGroupsForSteps(steps, model, models)
    expect(group.defaultExpanded).toBe(true)
    expect(group.details.map((detail) => detail.label)).toEqual(expect.arrayContaining([
      'Node type',
      'Border color',
      'Hide while flow plays',
      'Tracked by camera',
      'Tip angle',
      'RMM dimension',
      'MPD dimension',
      'Flow effect',
    ]))
    const flowDetail = group.details.find((detail) => detail.label === 'Flow effect')
    expect(flowDetail?.lines).toBeUndefined()
    expect(flowDetail?.flowPreview).toMatchObject({
      nodeId: 'cloud',
      selectedEffectId: 'fx',
    })
  })

  it('shows before and after values for settings and connection changes', () => {
    const groups = changeGroupsForSteps([
      {
        action: 'update-node-settings',
        nodeId: 'a',
        before: { cameraTracked: false, membraneColor: '#365f8f' },
        after: { cameraTracked: true, membraneColor: '#f59e0b' },
      },
      {
        action: 'update-edge-settings',
        edgeId: 'edge-ab',
        before: { kind: 'default', arrowStyle: 'standard' },
        after: { kind: 'flow', arrowStyle: 'circle', cameraTracked: true },
      },
    ], model)

    expect(groups[0].details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Tracked by camera', before: 'off', after: 'on' }),
      expect.objectContaining({ label: 'Border color', before: '#365f8f', after: '#f59e0b' }),
    ]))
    expect(groups[1].details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Connection type', before: 'default', after: 'flow' }),
      expect.objectContaining({ label: 'Arrow style', before: 'standard', after: 'circle' }),
    ]))
  })

  it('lists read-only flow effect diffs', () => {
    const [group] = changeGroupsForSteps([{
      action: 'update-flow-effects',
      nodeId: 'a',
      before: {
        flowEffects: [{
          id: 'fx',
          label: 'Old',
          graph: { nodes: [{ id: 'wait', kind: 'wait', x: 0, y: 0, params: { ms: 100 } }], edges: [] },
        }],
      },
      after: {
        flowEffects: [{
          id: 'fx',
          label: 'New',
          graph: {
            nodes: [
              { id: 'wait', kind: 'wait', x: 0, y: 0, params: { ms: 250 } },
              { id: 'move', kind: 'move', x: 80, y: 0, params: { dx: 5, dy: 0, ms: 300 } },
            ],
            edges: [{ from: 'wait', to: 'move' }],
          },
        }],
      },
      crossLinksBefore: [],
      crossLinksAfter: [{ id: 'xl', from: { nodeId: 'a', effectId: 'fx' }, to: { nodeId: 'b', effectId: 'fx2' } }],
    }], model)

    expect(group.details.map((detail) => detail.label)).toEqual(expect.arrayContaining(['Changed effect', 'Cross-links']))
    const changedEffect = group.details.find((detail) => detail.label === 'Changed effect')
    expect(changedEffect?.lines).toBeUndefined()
    expect(changedEffect?.flowPreview).toMatchObject({
      nodeId: 'a',
      selectedEffectId: 'fx',
      beforeEffects: [expect.objectContaining({ label: 'Old' })],
      afterEffects: [expect.objectContaining({ label: 'New' })],
    })
    expect(group.details.find((detail) => detail.label === 'Cross-links')?.flowPreview?.crossLinksAfter).toHaveLength(1)
  })

  it('exposes a flow preview for linked-node split view changes without cross-links', () => {
    const [group] = changeGroupsForSteps([{
      action: 'update-flow-effects',
      nodeId: 'a',
      before: {
        flowEffects: [{
          id: 'fx',
          label: 'Host FX',
          graph: { nodes: [{ id: 'wait', kind: 'wait', x: 0, y: 0, params: { ms: 100 } }], edges: [] },
        }],
        linkedNodeIds: null,
      },
      after: {
        flowEffects: [{
          id: 'fx',
          label: 'Host FX',
          graph: { nodes: [{ id: 'wait', kind: 'wait', x: 0, y: 0, params: { ms: 100 } }], edges: [] },
        }],
        linkedNodeIds: ['b'],
      },
    }], model)

    const linked = group.details.find((detail) => detail.label === 'Linked nodes')
    expect(linked).toMatchObject({
      before: '0',
      after: '1',
      flowPreview: {
        nodeId: 'a',
        selectedEffectId: 'fx',
      },
    })
  })
})
