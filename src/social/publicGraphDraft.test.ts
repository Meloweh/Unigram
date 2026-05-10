import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE, DEFAULT_NODE, type Model, type Project } from '../model/types'
import {
  capturePublicGraphBaseline,
  getPublicGraphDraftSteps,
  projectWithoutPublicGraphDrafts,
} from './publicGraphDraft'

describe('public graph draft diff', () => {
  it('turns local public edits into deterministic proposal steps', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    const alpha = currentModel.nodes.get('a')
    const beta = currentModel.nodes.get('b')
    const edge = currentModel.edges.get('edge-ab')
    expect(alpha && beta && edge).toBeTruthy()
    currentModel.nodes.set('a', { ...alpha!, x: 28, y: 20, w: 16, h: 9 })
    currentModel.nodes.set('b', { ...beta!, label: 'Beta renamed' })
    currentModel.nodes.set('c', { ...DEFAULT_NODE, id: 'c', label: 'Gamma', x: 50, y: 50, w: 12, h: 7 })
    currentModel.edges.set('edge-ab', {
      ...edge!,
      label: 'evidence',
      references: [{ title: 'Paper', citation: 'A. Example', url: 'https://example.test' }],
    })
    currentModel.edges.set('edge-ac', { ...DEFAULT_EDGE, id: 'edge-ac', from: 'a', to: 'c', label: 'new path' })
    currentModel.nodes.set('cloud', {
      ...DEFAULT_NODE,
      id: 'cloud',
      label: '',
      x: 60,
      y: 45,
      w: 14,
      h: 9,
      shape: 'thinking-cloud',
      cosmeticType: 'thinking-cloud',
      cellColor: '#eaf3ff',
      membraneColor: '#365f8f',
      cameraTracked: true,
    })

    const steps = getPublicGraphDraftSteps(projectWith(currentModel))
    expect(steps.map((step) => step.action)).toEqual([
      'add-node',
      'add-node',
      'add-edge',
      'rename-node',
      'rename-edge',
      'modify-references',
      'commit-transform',
    ])
    expect(steps[0]).toMatchObject({ action: 'add-node', nodeId: 'c', newNodeLabel: 'Gamma' })
    expect(steps[1]).toMatchObject({
      action: 'add-node',
      nodeId: 'cloud',
      newNodeLabel: 'Thinking cloud',
      node: { label: '', shape: 'thinking-cloud', cosmeticType: 'thinking-cloud', cameraTracked: true },
    })
    expect(steps[2]).toMatchObject({ action: 'add-edge', edgeId: 'edge-ac', sourceNodeId: 'a', targetNodeId: 'c' })
    expect(steps[6]).toMatchObject({ action: 'commit-transform', transforms: [{ nodeId: 'a' }] })
  })

  it('projects autosave back to the server baseline', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    currentModel.nodes.set('a', { ...currentModel.nodes.get('a')!, x: 42 })
    currentModel.nodes.set('c', { ...DEFAULT_NODE, id: 'c', label: 'Gamma', x: 40, y: 40, w: 12, h: 7 })

    const projected = projectWithoutPublicGraphDrafts(projectWith(currentModel))
    const projectedModel = projected.models.get('root')
    expect(projectedModel?.nodes.has('c')).toBe(false)
    expect(projectedModel?.nodes.get('a')?.x).toBe(10)
  })

  it('captures local RMM and MPD dimension additions as chain steps', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    currentModel.nodes.set('a', {
      ...currentModel.nodes.get('a')!,
      childModelId: 'rmm-1',
      mpdDimensions: ['root', 'mpd-1', 'external:graph-2:a'],
      externalMpdLinks: {
        'external:graph-2:a': {
          id: 'external:graph-2:a',
          diagramId: 'graph-2',
          diagramTitle: 'Graph Two',
          nodeLabel: 'A',
        },
      },
    })
    currentModel.nodes.set('b', {
      ...currentModel.nodes.get('b')!,
      childModelId: 'external-rmm:graph-3:beta',
      externalRmmLink: {
        id: 'external-rmm:graph-3:beta',
        diagramId: 'graph-3',
        diagramTitle: 'Graph Three',
        nodeLabel: 'Beta',
      },
    })
    const current: Project = {
      rootModelId: 'root',
      models: new Map([
        ['root', currentModel],
        ['rmm-1', { id: 'rmm-1', name: 'Nested detail', nodes: new Map(), edges: new Map() }],
        ['mpd-1', { id: 'mpd-1', name: 'Alternate lens', nodes: new Map(), edges: new Map() }],
      ]),
    }

    expect(getPublicGraphDraftSteps(current)).toEqual([
      { action: 'add-rmm', nodeId: 'a', name: 'Nested detail' },
      { action: 'add-mpd', nodeId: 'a', name: 'Alternate lens' },
      {
        action: 'add-mpd',
        nodeId: 'a',
        name: 'Graph Two',
        externalLink: {
          id: 'external:graph-2:a',
          diagramId: 'graph-2',
          diagramTitle: 'Graph Two',
          nodeLabel: 'A',
        },
      },
      {
        action: 'add-rmm',
        nodeId: 'b',
        name: 'Graph Three',
        externalLink: {
          id: 'external-rmm:graph-3:beta',
          diagramId: 'graph-3',
          diagramTitle: 'Graph Three',
          nodeLabel: 'Beta',
        },
      },
    ])
  })

  it('captures settings, media, flow graph, references, and connection type changes', () => {
    const baseline = projectWith(modelWithBaseGraph())
    capturePublicGraphBaseline(baseline)
    const currentModel = cloneModel(modelWithBaseGraph())
    const alpha = currentModel.nodes.get('a')!
    const edge = currentModel.edges.get('edge-ab')!
    currentModel.nodes.set('a', {
      ...alpha,
      shape: 'diamond',
      cellColor: '#ffeeaa',
      mediaType: 'video',
      mediaSrc: 'media/clip.mp4',
      mediaFileName: 'clip.mp4',
      flowEffects: [{ id: 'fx1', label: 'Emerge', graph: { nodes: [], edges: [] } }],
      linkedNodeIds: ['b'],
    })
    currentModel.edges.set('edge-ab', {
      ...edge,
      kind: 'flow',
      dash: 'dashed',
      arrowStyle: 'circle',
      cameraTracked: true,
      references: [{ title: 'Ref', citation: 'Citation', url: 'https://example.test/ref' }],
    })
    currentModel.crossLinks = [
      { id: 'xl1', from: { nodeId: 'a', effectId: 'fx1' }, to: { nodeId: 'b', effectId: 'fx2' } },
    ]

    const steps = getPublicGraphDraftSteps(projectWith(currentModel))
    expect(steps.map((step) => step.action)).toEqual([
      'update-node-settings',
      'update-node-media',
      'update-flow-effects',
      'modify-references',
      'update-edge-settings',
    ])
    expect(steps.find((step) => step.action === 'update-node-media')).toMatchObject({
      action: 'update-node-media',
      nodeId: 'a',
      after: { mediaType: 'video', mediaSrc: 'media/clip.mp4', mediaFileName: 'clip.mp4' },
    })
    expect(steps.find((step) => step.action === 'update-edge-settings')).toMatchObject({
      action: 'update-edge-settings',
      edgeId: 'edge-ab',
      after: { kind: 'flow', dash: 'dashed', arrowStyle: 'circle', cameraTracked: true },
    })
    expect(steps.find((step) => step.action === 'update-flow-effects')).toMatchObject({
      action: 'update-flow-effects',
      nodeId: 'a',
      crossLinksAfter: currentModel.crossLinks,
    })
  })

  it('captures effect graph cross-link-only changes', () => {
    const baselineModel = modelWithBaseGraph()
    baselineModel.nodes.set('a', {
      ...baselineModel.nodes.get('a')!,
      flowEffects: [{ id: 'fx-a', label: 'A effect', graph: { nodes: [], edges: [] } }],
    })
    baselineModel.nodes.set('b', {
      ...baselineModel.nodes.get('b')!,
      flowEffects: [{ id: 'fx-b', label: 'B effect', graph: { nodes: [], edges: [] } }],
    })
    capturePublicGraphBaseline(projectWith(baselineModel))
    const currentModel = cloneModel(baselineModel)
    currentModel.crossLinks = [
      { id: 'xl', from: { nodeId: 'a', effectId: 'fx-a' }, to: { nodeId: 'b', effectId: 'fx-b' } },
    ]

    const steps = getPublicGraphDraftSteps(projectWith(currentModel))
    expect(steps).toEqual([
      {
        action: 'update-flow-effects',
        nodeId: 'a',
        before: {
          flowEffects: baselineModel.nodes.get('a')?.flowEffects,
          linkedNodeIds: null,
        },
        after: {
          flowEffects: currentModel.nodes.get('a')?.flowEffects,
          linkedNodeIds: null,
        },
        crossLinksBefore: [],
        crossLinksAfter: currentModel.crossLinks,
      },
    ])
  })
})

function modelWithBaseGraph(): Model {
  return {
    id: 'root',
    name: 'Public baseline',
    nodes: new Map([
      ['a', { ...DEFAULT_NODE, id: 'a', label: 'Alpha', x: 10, y: 10, w: 12, h: 7 }],
      ['b', { ...DEFAULT_NODE, id: 'b', label: 'Beta', x: 30, y: 10, w: 12, h: 7 }],
    ]),
    edges: new Map([
      ['edge-ab', { ...DEFAULT_EDGE, id: 'edge-ab', from: 'a', to: 'b' }],
    ]),
  }
}

function cloneModel(model: Model): Model {
  return {
    ...model,
    nodes: new Map([...model.nodes].map(([id, node]) => [id, { ...node }])),
    edges: new Map([...model.edges].map(([id, edge]) => [id, { ...edge, references: edge.references?.map((ref) => ({ ...ref })) }])),
  }
}

function projectWith(model: Model): Project {
  return { rootModelId: model.id, models: new Map([[model.id, model]]) }
}
